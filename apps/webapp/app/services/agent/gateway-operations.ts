import { getConnectedGateways } from "~/services/gateway.server";
import { runGatewayExplorer } from "./gateway";
import { isGatewayConnected } from "../../../websocket";
import { logger } from "~/services/logger.service";

// Types for gateway tools
interface GatewayToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface GatewayMCPTool {
  id: string;
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations: {
    readOnlyHint: boolean;
    idempotentHint: boolean;
    destructiveHint: boolean;
  };
}

/**
 * Categorize gateway tools for description
 */
function categorizeTools(tools: GatewayToolDef[]): string {
  const categories: string[] = [];

  const hasBrowser = tools.some((t) => t.name.startsWith("browser_"));
  const hasCoding = tools.some((t) => t.name.startsWith("coding_"));
  const hasExec = tools.some((t) => t.name.startsWith("exec_"));

  if (hasBrowser) categories.push("browser automation");
  if (hasCoding) categories.push("coding agents");
  if (hasExec) categories.push("shell commands");

  return categories.length > 0 ? categories.join(", ") : "custom tools";
}

/**
 * Create MCP tool definitions for connected gateways
 * Each gateway becomes a tool that can be called with an intent
 */
export async function getGatewayMCPTools(
  workspaceId: string,
): Promise<GatewayMCPTool[]> {
  const gateways = await getConnectedGateways(workspaceId);

  return gateways
    .filter((gateway) => isGatewayConnected(gateway.id))
    .map((gateway) => {
      const tools = (gateway.tools || []) as unknown as GatewayToolDef[];
      const toolName = `gateway_${gateway.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const capabilities = categorizeTools(tools);
      const description = gateway.description || "General purpose gateway";

      return {
        id: gateway.id,
        name: toolName,
        description: `**${gateway.name}** - ${description}

Capabilities: ${capabilities}

USE THIS TOOL to offload tasks like:
- Automate browsers (open pages, fill forms, click, screenshot)
- Spawn coding agents for development work
- Execute shell commands and scripts`,
        inputSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description:
                "Describe what you want to accomplish. Be specific about the task, include URLs, file paths, or commands as needed.",
            },
          },
          required: ["intent"],
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
        },
      };
    });
}

/**
 * Handle a gateway tool call by running the sub-agent
 */
export async function handleGatewayToolCall(
  gatewayId: string,
  gatewayName: string,
  intent: string,
): Promise<{ content: { type: string; text: string }[]; isError: boolean }> {
  if (!isGatewayConnected(gatewayId)) {
    return {
      content: [
        {
          type: "text",
          text: `Gateway "${gatewayName}" is not connected.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const { stream, gatewayConnected } = await runGatewayExplorer(
      gatewayId,
      intent,
    );

    if (!gatewayConnected || !stream) {
      return {
        content: [
          {
            type: "text",
            text: `Gateway "${gatewayName}" disconnected during execution.`,
          },
        ],
        isError: true,
      };
    }

    // Collect the streamed response
    const result = stream;
    const fullResponse = await result.text;

    return {
      content: [
        {
          type: "text",
          text:
            fullResponse || "Gateway agent completed but returned no output.",
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error("Error running gateway agent:", { error });
    return {
      content: [
        {
          type: "text",
          text: `Error running gateway agent: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
