/**
 * OrchestratorTools abstraction
 *
 * Allows the orchestrator to run in two contexts:
 * - Server (web chat): DirectOrchestratorTools — calls functions directly (DB/websocket)
 * - Trigger/BullMQ jobs: HttpOrchestratorTools — calls via CoreClient HTTP
 *
 * Only leaf operations that touch DB/websocket are abstracted here.
 * The orchestrator calls these methods directly for integrations,
 * and delegates to gateway-explorer for gateway operations.
 */

import { searchMemoryWithAgent } from "./memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getConnectedGateways } from "~/services/gateway.server";
import {
  handleGetIntegrationActions,
  handleExecuteIntegrationAction,
} from "~/utils/mcp/integration-operations";
import { callGatewayTool } from "../../../websocket";
import { prisma } from "~/db.server";
import { logger } from "../logger.service";

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
  tools: string[];
  platform: string | null;
  hostname: string | null;
  status: "CONNECTED" | "DISCONNECTED";
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
}

// ---------------------------------------------------------------------------
// Direct implementation — calls functions directly (server context)
// ---------------------------------------------------------------------------

export class DirectOrchestratorTools extends OrchestratorTools {
  async searchMemory(
    query: string,
    userId: string,
    workspaceId: string,
    source: string,
  ): Promise<string> {
    try {
      const result = await searchMemoryWithAgent(query, userId, workspaceId, source, {
        structured: false,
      });
      if (result && typeof result === "object" && "content" in result) {
        const content = (result as any).content;
        if (Array.isArray(content) && content.length > 0) {
          return content[0].text ?? "nothing found";
        }
      }
      return "nothing found";
    } catch (error) {
      logger.warn("DirectOrchestratorTools: memory search failed", { error });
      return "nothing found";
    }
  }

  async getIntegrations(
    userId: string,
    workspaceId: string,
  ): Promise<ConnectedIntegration[]> {
    const accounts = await IntegrationLoader.getConnectedIntegrationAccounts(
      userId,
      workspaceId,
    );
    return accounts.map((a) => ({
      id: a.id,
      accountId: a.accountId ?? null,
      integrationDefinition: {
        id: a.integrationDefinition.id,
        name: a.integrationDefinition.name,
        slug: a.integrationDefinition.slug,
      },
    }));
  }

  async getGateways(workspaceId: string): Promise<GatewayAgentInfo[]> {
    const gateways = await getConnectedGateways(workspaceId);
    return gateways.map((gw) => {
      const tools = (gw.tools || []) as any as { name: string }[];
      return {
        id: gw.id,
        name: gw.name,
        description: gw.description || `Gateway: ${gw.name}`,
        tools: tools.map((t) => t.name),
        platform: gw.platform,
        hostname: gw.hostname,
        status: gw.status as "CONNECTED" | "DISCONNECTED",
      };
    });
  }

  async getIntegrationActions(
    accountId: string,
    query: string,
    userId: string,
  ): Promise<unknown> {
    return handleGetIntegrationActions({ accountId, query, userId });
  }

  async executeIntegrationAction(
    accountId: string,
    action: string,
    parameters: Record<string, unknown>,
    userId: string,
    source: string,
  ): Promise<unknown> {
    return handleExecuteIntegrationAction({
      accountId,
      action,
      parameters,
      source,
      userId,
    });
  }

  async executeGatewayTool(
    gatewayId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return callGatewayTool(gatewayId, toolName, params, 60000);
  }

  async getSkill(skillId: string, workspaceId: string): Promise<string> {
    try {
      const skill = await prisma.document.findFirst({
        where: { id: skillId, workspaceId, type: "skill", deleted: null },
        select: { id: true, title: true, content: true },
      });
      if (!skill) return "Skill not found";
      return `## Skill: ${skill.title}\n\n${skill.content}`;
    } catch (error) {
      logger.warn("DirectOrchestratorTools: failed to load skill", { error });
      return "Failed to load skill";
    }
  }
}
