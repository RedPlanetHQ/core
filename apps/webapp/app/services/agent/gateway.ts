/**
 * Re-export from new location.
 * @deprecated Import from ~/services/agent/agents/gateway instead.
 *
 * Provides backward-compatible exports for callers that haven't been updated.
 */

import { type Agent } from "@mastra/core/agent";
import { type GatewayAgentInfo } from "./executors/base";
import { getConnectedGateways } from "~/services/gateway.server";
import { getGateway } from "~/services/gateway.server";
import { streamText, type LanguageModel, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getModel, getModelForTask } from "~/lib/model.server";
import { logger } from "~/services/logger.service";
import { callGatewayTool } from "../../../websocket";
import { type OrchestratorTools } from "./executors/base";

// Re-export types
export type { GatewayAgentInfo } from "./executors/base";

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
          return `ERROR: ${errorMessage}`;
        }
      },
    });
  }

  return tools;
}

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

RESPONSE:
After execution, provide a clear summary of:
- What was done
- Results or outputs
- Any errors encountered`;
};

export interface GatewayExplorerResult {
  stream?: ReturnType<typeof streamText>;
  startTime: number;
  gatewayConnected: boolean;
}

/**
 * @deprecated Use createGatewayAgent from ~/services/agent/agents/gateway instead.
 * Kept for backward compatibility with gateway API routes.
 */
export async function runGatewayExplorer(
  gatewayId: string,
  intent: string,
  abortSignal?: AbortSignal,
  executorTools?: OrchestratorTools,
): Promise<GatewayExplorerResult> {
  const startTime = Date.now();

  const gateway = await getGateway(gatewayId);

  if (!gateway) {
    return {
      startTime,
      gatewayConnected: false,
    };
  }

  const gatewayTools = (gateway.tools || []) as unknown as GatewayTool[];
  const tools = createDirectGatewayTools(
    gatewayId,
    gatewayTools,
    executorTools,
  );

  const model = getModelForTask("medium");
  const modelInstance = getModel(model);

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: getGatewayExplorerPrompt(
      gateway.name,
      gateway.description,
      gatewayTools,
    ),
    messages: [{ role: "user", content: intent }],
    tools,
    stopWhen: stepCountIs(100),
    abortSignal,
  });

  return {
    stream: stream as any,
    startTime,
    gatewayConnected: true,
  };
}

/**
 * @deprecated Use createGatewayAgents from ~/services/agent/agents/gateway instead.
 */
export async function getGatewayAgents(
  workspaceId: string,
): Promise<GatewayAgentInfo[]> {
  const gateways = await getConnectedGateways(workspaceId);

  return gateways.map((gateway: GatewayAgentInfo) => {
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
