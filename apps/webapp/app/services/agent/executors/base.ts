/**
 * OrchestratorTools abstraction
 *
 * Allows the orchestrator to run in two contexts:
 * - Server (web chat): DirectOrchestratorTools — calls functions directly (DB/websocket)
 * - Trigger/BullMQ jobs: HttpOrchestratorTools — calls via CoreClient HTTP
 *
 * Only leaf operations that touch DB/websocket are abstracted here.
 * The orchestrator calls these methods directly for integrations,
 * and delegates to gateway agents for gateway operations.
 */

import type { MessageChannel } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectedIntegration {
  id: string;
  accountId: string | null;
  integrationDefinition: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface GatewayAgentInfo {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  tools: string[];
  platform: string | null;
  hostname: string | null;
  status: "CONNECTED" | "DISCONNECTED";
}

export interface SendChannelMessageParams {
  channel: MessageChannel | "web";
  message: string;
  userId: string;
  workspaceId: string;
  conversationId?: string;
  channelMetadata?: Record<string, unknown>;
}

export interface SendChannelMessageResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class OrchestratorTools {
  /** Search memory for relevant context. Returns formatted text. */
  abstract searchMemory(
    query: string,
    userId: string,
    workspaceId: string,
    source: string,
  ): Promise<string>;

  /** Get connected integration accounts for the workspace. */
  abstract getIntegrations(
    userId: string,
    workspaceId: string,
  ): Promise<ConnectedIntegration[]>;

  /** Get connected gateways for the workspace. Returns GatewayAgentInfo[]. */
  abstract getGateways(workspaceId: string): Promise<GatewayAgentInfo[]>;

  /** Get available actions for an integration account. */
  abstract getIntegrationActions(
    accountId: string,
    query: string,
    userId: string,
  ): Promise<unknown>;

  /** Execute an action on an integration account. */
  abstract executeIntegrationAction(
    accountId: string,
    action: string,
    parameters: Record<string, unknown>,
    userId: string,
    source: string,
  ): Promise<unknown>;

  /** Execute a specific tool on a gateway. */
  abstract executeGatewayTool(
    gatewayId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  /** Load a skill's full content by ID. */
  abstract getSkill(skillId: string, workspaceId: string): Promise<string>;

  /** Send a message to a channel and save to conversation. */
  abstract sendChannelMessage(
    params: SendChannelMessageParams,
  ): Promise<SendChannelMessageResult>;
}
