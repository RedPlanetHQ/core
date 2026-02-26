/**
 * HttpOrchestratorTools
 *
 * Implementation of OrchestratorTools that delegates all DB/websocket operations
 * to the server via CoreClient HTTP calls.
 *
 * Used when the orchestrator runs in a Trigger/BullMQ job context where
 * direct DB access is not available.
 */

import { CoreClient } from "@redplanethq/sdk";
import { OrchestratorTools, type ConnectedIntegration, type GatewayAgentInfo } from "./orchestrator-tools";
import { logger } from "../logger.service";

export class HttpOrchestratorTools extends OrchestratorTools {
  constructor(private client: CoreClient) {
    super();
  }

  async searchMemory(
    query: string,
    _userId: string,
    _workspaceId: string,
    _source: string,
  ): Promise<string> {
    try {
      const result = await this.client.search({ query });
      // Format episodes to text
      const episodes = (result as any).episodes ?? [];
      if (!episodes.length) return "nothing found";
      return episodes
        .map((ep: any, i: number) => `### Episode ${i + 1}\n${ep.content}`)
        .join("\n\n");
    } catch (error) {
      logger.warn("HttpOrchestratorTools: memory search failed", { error });
      return "nothing found";
    }
  }

  async getIntegrations(
    _userId: string,
    _workspaceId: string,
  ): Promise<ConnectedIntegration[]> {
    const response = await this.client.getIntegrationsConnected();
    return (response.accounts ?? []).map((a: any) => ({
      id: a.id,
      accountId: a.accountId ?? null,
      integrationDefinition: {
        id: a.integrationDefinition?.id ?? a.id,
        name: a.integrationDefinition?.name ?? a.name ?? a.slug ?? "",
        slug: a.integrationDefinition?.slug ?? a.slug ?? "",
      },
    }));
  }

  async getGateways(_workspaceId: string): Promise<GatewayAgentInfo[]> {
    const response = await this.client.getGateways();
    return (response.gateways ?? []) as GatewayAgentInfo[];
  }

  async getIntegrationActions(
    accountId: string,
    query: string,
    _userId: string,
  ): Promise<unknown> {
    const response = await this.client.getIntegrationActions({ accountId, query });
    return response;
  }

  async executeIntegrationAction(
    accountId: string,
    action: string,
    parameters: Record<string, unknown>,
    _userId: string,
    _source: string,
  ): Promise<unknown> {
    const response = await this.client.executeIntegrationAction({
      accountId,
      action,
      parameters,
    });
    return response;
  }

  async executeGatewayTool(
    gatewayId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // Proxy the tool call to the server — server handles the websocket connection
    const response = await this.client.executeGatewayTool({ gatewayId, toolName, params });
    return response.result;
  }

  async getSkill(skillId: string, _workspaceId: string): Promise<string> {
    try {
      const response = await this.client.getDocument({ documentId: skillId });
      if (!response.document) return "Skill not found";
      const doc = response.document as any;
      return `## Skill: ${doc.title ?? ""}\n\n${doc.content ?? ""}`;
    } catch (error) {
      logger.warn("HttpOrchestratorTools: failed to load skill", { error });
      return "Failed to load skill";
    }
  }
}
