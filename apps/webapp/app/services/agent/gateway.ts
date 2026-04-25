/**
 * Re-export from new location.
 * @deprecated Import from ~/services/agent/agents/gateway instead.
 *
 * Provides backward-compatible exports for callers that haven't been updated.
 */

import { type Agent } from "@mastra/core/agent";
import { stepCountIs } from "ai";
import {
  type GatewayAgentInfo,
  type OrchestratorTools,
} from "./executors/base";
import { getConnectedGateways } from "~/services/gateway.server";
import { createGatewayAgent } from "./agents/gateway";
import { mastra } from "./mastra";

// Re-export types
export type { GatewayAgentInfo } from "./executors/base";

export interface GatewayExplorerResult {
  stream?: any;
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

  const { agent, connected } = await createGatewayAgent(
    gatewayId,
    executorTools,
    false,
  );

  if (!connected) {
    return {
      startTime,
      gatewayConnected: false,
    };
  }

  agent.__registerMastra(mastra);

  const stream = await agent.stream([{ role: "user", content: intent }], {
    stopWhen: [stepCountIs(100)],
    ...(abortSignal && { abortSignal }),
  });

  return {
    stream,
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

  return gateways.map((gateway) => {
    return {
      id: gateway.id,
      name: gateway.name,
      description: gateway.description || `Gateway: ${gateway.name}`,
      // Tool names aren't cached on the row anymore; live-fetch happens when
      // the agent is created. Callers that only need the routing list get [].
      tools: [],
      platform: gateway.platform,
      hostname: gateway.hostname,
      status: gateway.status as "CONNECTED" | "DISCONNECTED",
    };
  });
}
