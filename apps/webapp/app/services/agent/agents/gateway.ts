/**
 * Gateway Agent Factory
 *
 * Gateway tool helpers — converts gateway JSON schema tools into AI SDK tools
 * that are registered directly on the core agent (not via the orchestrator).
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getGateway } from "~/services/gateway.server";
import { toRouterString } from "~/lib/model.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import {
  type OrchestratorTools,
  type GatewayAgentInfo,
} from "../executors/base";
import { callGatewayTool } from "../../../../websocket";

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
export function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): any {
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
export function gatewayToolToZodSchema(
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

const APPROVAL_REQUIRED_PATTERNS = [/^coding_ask$/i, /^exec_/i];

function requiresApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_PATTERNS.some((p) => p.test(toolName));
}

/**
 * Create Mastra tools from a gateway's tool definitions.
 * Each gateway tool becomes a Mastra createTool() with proper Zod schema.
 */
function createGatewayTools(
  gatewayId: string,
  gatewayTools: GatewayTool[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
) {
  const tools: Record<string, any> = {};

  for (const gatewayTool of gatewayTools) {
    const zodSchema = gatewayToolToZodSchema(gatewayTool);

    tools[gatewayTool.name] = createTool({
      id: gatewayTool.name,
      description: gatewayTool.description,
      inputSchema: zodSchema,
      requireApproval: interactive && requiresApproval(gatewayTool.name),
      execute: async (params) => {
        try {
          logger.info(
            `GatewayAgent: Executing ${gatewayId}/${gatewayTool.name} with params: ${JSON.stringify(params)}`,
          );

          const result = executorTools
            ? await executorTools.executeGatewayTool(
                gatewayId,
                gatewayTool.name,
                params as Record<string, unknown>,
              )
            : await callGatewayTool(
                gatewayId,
                gatewayTool.name,
                params as Record<string, unknown>,
                60000,
              );

          const r = result as Record<string, unknown>;
          if (r?.screenshot && typeof r.screenshot === "string" && r.mimeType) {
            return [
              {
                type: "image" as const,
                data: r.screenshot,
                mimeType: r.mimeType as string,
              },
            ];
          }

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

// === Gateway Agent Prompt ===

const getGatewayAgentPrompt = (
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

// === Factory ===

/**
 * Create a Mastra Agent for a specific gateway.
 * The agent has direct access to the gateway's tools.
 */
export async function createGatewayAgent(
  gatewayId: string,
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  modelConfig?: ModelConfig,
): Promise<{ agent: Agent; connected: boolean }> {
  const gateway = await getGateway(gatewayId);

  const resolvedModel = modelConfig ?? toRouterString(getDefaultChatModelId());

  if (!gateway) {
    // Return a disconnected placeholder
    return {
      agent: new Agent({
        id: `gateway_disconnected`,
        name: "Disconnected Gateway",
        model: resolvedModel as any,
        instructions: "This gateway is not connected.",
      }),
      connected: false,
    };
  }

  const gatewayTools = (gateway.tools || []) as unknown as GatewayTool[];
  const tools = createGatewayTools(
    gatewayId,
    gatewayTools,
    executorTools,
    interactive,
  );

  const agentId = `gateway_${gateway.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  logger.info(
    `GatewayAgent: Creating agent "${agentId}" with ${gatewayTools.length} tools`,
  );

  const agent = new Agent({
    id: agentId,
    name: gateway.name,
    model: resolvedModel as any,
    instructions: getGatewayAgentPrompt(
      gateway.name,
      gateway.description,
      gatewayTools,
    ),
    tools,
  });

  return { agent, connected: true };
}

/**
 * Create gateway agents for all connected gateways in a workspace.
 * Returns a map of agent ID → Agent, plus the flat list.
 */
export async function createGatewayAgents(
  gateways: GatewayAgentInfo[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  modelConfig?: ModelConfig,
): Promise<{ agents: Record<string, Agent>; agentList: Agent[] }> {
  const agents: Record<string, Agent> = {};
  const agentList: Agent[] = [];

  for (const gw of gateways) {
    if (gw.status !== "CONNECTED") continue;

    const { agent, connected } = await createGatewayAgent(
      gw.id,
      executorTools,
      interactive,
    );
    if (connected) {
      const agentId = `gateway_${gw.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      agents[agentId] = agent;
      agentList.push(agent);
    }
  }

  return { agents, agentList };
}
