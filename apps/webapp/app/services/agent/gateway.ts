import {
  streamText,
  type LanguageModel,
  stepCountIs,
  tool,
  readUIMessageStream,
} from "ai";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getModel, getModelForTask } from "~/lib/model.server";
import { getConnectedGateways, getGateway } from "~/services/gateway.server";
import { callGatewayTool } from "../../../websocket";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";

// Types for gateway tools (matches schema in database)
interface GatewayTool {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  items?: { type?: string };
  default?: unknown;
}

/**
 * Convert a JSON Schema property to a Zod schema
 */
function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): any {
  switch (prop.type) {
    case "string":
      return z.string().describe(prop.description || "");
    case "number":
      return z.number().describe(prop.description || "");
    case "boolean":
      return z.boolean().describe(prop.description || "");
    case "array":
      if (prop.items?.type === "string") {
        return z.array(z.string()).describe(prop.description || "");
      }
      return z.array(z.unknown()).describe(prop.description || "");
    case "object":
      return z.record(z.string(), z.unknown()).describe(prop.description || "");
    default:
      return z.unknown().describe(prop.description || "");
  }
}

/**
 * Convert a gateway tool's JSON Schema to a Zod object schema
 */
function gatewayToolToZodSchema(
  gatewayTool: GatewayTool,
): z.ZodObject<Record<string, any>> {
  const schema = gatewayTool.inputSchema;
  if (!schema || !schema.properties) {
    return z.object({});
  }

  const shape: Record<string, any> = {};
  const required = schema.required || [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodProp = jsonSchemaPropertyToZod(prop);
    if (!required.includes(key)) {
      zodProp = zodProp.optional();
    }
    shape[key] = zodProp;
  }

  return z.object(shape);
}

/**
 * Create direct tools for a gateway's available tools
 * Each gateway tool becomes a real Zod-typed tool
 */
function createDirectGatewayTools(
  gatewayId: string,
  gatewayTools: GatewayTool[],
  executorTools?: OrchestratorTools,
) {
  const tools: Record<string, any> = {};

  for (const gatewayTool of gatewayTools) {
    const zodSchema = gatewayToolToZodSchema(gatewayTool);

    tools[gatewayTool.name] = tool({
      description: gatewayTool.description,
      inputSchema: zodSchema,
      execute: async (params) => {
        try {
          logger.info(
            `GatewayExplorer: Executing ${gatewayId}/${gatewayTool.name} with params: ${JSON.stringify(params)}`,
          );

          const result = executorTools
            ? await executorTools.executeGatewayTool(gatewayId, gatewayTool.name, params as Record<string, unknown>)
            : await callGatewayTool(gatewayId, gatewayTool.name, params as Record<string, unknown>, 60000);

          return JSON.stringify(result, null, 2);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.warn(`Gateway tool failed: ${gatewayId}/${gatewayTool.name}`, {
            error,
          });
          return `ERROR: ${errorMessage}`;
        }
      },
    });
  }

  return tools;
}

// === Gateway Explorer Prompt ===

const getGatewayExplorerPrompt = (
  gatewayName: string,
  gatewayDescription: string | null,
  tools: GatewayTool[],
) => {
  const toolsList = tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join("\n");

  return `You are an execution agent for the "${gatewayName}" gateway.
${gatewayDescription ? `\nPurpose: ${gatewayDescription}\n` : ""}
AVAILABLE TOOLS:
${toolsList}

EXECUTION:
1. Analyze the intent
2. Select the right tool(s)
3. Execute with correct parameters
4. Chain tools if needed for multi-step tasks

TOOL CATEGORIES:
- **Browser tools** (browser_*): Web automation - open pages, click, fill forms, take screenshots
- **Coding tools** (coding_*): Spawn coding agents for development tasks
- **Shell tools** (exec_*): Run commands and scripts

RESPONSE:
After execution, provide a clear summary of:
- What was done
- Results or outputs
- Any errors encountered`;
};

// === Gateway Sub-Agent Executor ===

export interface GatewayExplorerResult {
  stream?: ReturnType<typeof streamText>;
  startTime: number;
  gatewayConnected: boolean;
}

/**
 * Run a sub-agent for a specific gateway
 * Similar to integration-explorer but for gateway tools
 */
export async function runGatewayExplorer(
  gatewayId: string,
  intent: string,
  abortSignal?: AbortSignal,
  executorTools?: OrchestratorTools,
): Promise<GatewayExplorerResult> {
  const startTime = Date.now();

  // Get gateway details from database

  const gateway = await getGateway(gatewayId);

  if (!gateway) {
    return {
      startTime,
      gatewayConnected: false,
    };
  }

  const gatewayTools = (gateway.tools || []) as unknown as GatewayTool[];

  // Create direct tools from the gateway's tool definitions
  // Each gateway tool becomes a real Zod-typed tool the sub-agent can call directly
  const tools = createDirectGatewayTools(gatewayId, gatewayTools, executorTools);

  const model = getModelForTask("high");
  const modelInstance = getModel(model);

  logger.info(
    `GatewayExplorer: Starting stream for gateway "${gateway.name}" with ${gatewayTools.length} tools`,
  );

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: getGatewayExplorerPrompt(
      gateway.name,
      gateway.description,
      gatewayTools,
    ),
    messages: [{ role: "user", content: intent }],
    tools,
    stopWhen: stepCountIs(15), // Allow more steps for complex gateway operations
    abortSignal,
  });

  return {
    stream: stream as any,
    startTime,
    gatewayConnected: true,
  };
}

// === Get Gateway Agents (for core-agent tools) ===

export type { GatewayAgentInfo } from "~/services/agent/orchestrator-tools";

/**
 * Get all gateways as agent info for the workspace
 * Used by core-agent to create gateway tools dynamically
 */
export async function getGatewayAgents(
  workspaceId: string,
): Promise<GatewayAgentInfo[]> {
  const gateways = await getConnectedGateways(workspaceId);

  return gateways.map((gateway) => {
    const tools = (gateway.tools || []) as any as GatewayTool[];
    return {
      id: gateway.id,
      name: gateway.name,
      description: gateway.description || `Gateway: ${gateway.name}`,
      tools: tools.map((t) => t.name),
      platform: gateway.platform,
      hostname: gateway.hostname,
      status: gateway.status as "CONNECTED" | "DISCONNECTED",
    };
  });
}

// === Create Gateway Tools for Core Agent ===

/**
 * Categorize gateway tools for description
 */
function categorizeTools(toolNames: string[]): string {
  const categories: string[] = [];

  if (toolNames.some((t) => t.startsWith("browser_")))
    categories.push("browser automation");
  if (toolNames.some((t) => t.startsWith("coding_")))
    categories.push("coding agents");
  if (toolNames.some((t) => t.startsWith("exec_")))
    categories.push("shell commands");

  return categories.length > 0 ? categories.join(", ") : "custom tools";
}

/**
 * Create tools for all connected gateways
 * Each gateway becomes a tool that can be called with an intent
 */
export function createGatewayTools(gateways: GatewayAgentInfo[]) {
  const tools: Record<string, any> = {};

  gateways.forEach((gateway) => {
    if (gateway.status !== "CONNECTED") return;

    const toolName = `gateway_${gateway.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const capabilities = categorizeTools(gateway.tools);

    tools[toolName] = tool({
      description: `**${gateway.name}** - ${gateway.description}

Capabilities: ${capabilities}

USE THIS TOOL to offload tasks like:
- Automate browsers (open pages, fill forms, click, screenshot)
- Spawn coding agents for development work
- Execute shell commands and scripts`,
      inputSchema: z.object({
        intent: z
          .string()
          .describe(
            "Describe what you want to accomplish. Be specific about the task, include URLs, file paths, or commands as needed.",
          ),
      }),
      execute: async function* ({ intent }, { abortSignal }) {
        logger.info(
          `Gateway tool: Executing intent on ${gateway.name}: ${intent}`,
        );

        const { stream, gatewayConnected } = await runGatewayExplorer(
          gateway.id,
          intent,
          abortSignal,
        );

        if (!gatewayConnected || !stream) {
          yield {
            parts: [
              {
                type: "text",
                text: `Gateway "${gateway.name}" is not connected.`,
              },
            ],
          };
          return;
        }

        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
        }
      },
    });
  });

  return tools;
}
