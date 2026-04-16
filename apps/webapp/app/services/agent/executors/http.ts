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
import { UserTypeEnum } from "@core/types";
import {
  OrchestratorTools,
  type ConnectedIntegration,
  type GatewayAgentInfo,
  type SendChannelMessageParams,
  type SendChannelMessageResult,
} from "./base";
import { logger } from "../../logger.service";
import { getChannel } from "~/services/channels";
import { prisma } from "~/db.server";

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
      const response = await this.client.getSkill({ skillId });
      if (!response.skill) return "Skill not found";
      const skill = response.skill as any;
      return `## Skill: ${skill.title ?? ""}\n\n${skill.content ?? ""}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn("HttpOrchestratorTools: failed to load skill", {
        skillId,
        error: msg,
      });
      return `Failed to load skill: ${msg}`;
    }
  }

  async sendChannelMessage(
    params: SendChannelMessageParams,
  ): Promise<SendChannelMessageResult> {
    const {
      channel,
      message,
      userId,
      workspaceId,
      conversationId,
      channelMetadata,
    } = params;

    try {
      // 1. Add assistant message to conversation if conversationId provided
      if (conversationId) {
        await prisma.conversationHistory.create({
          data: {
            conversationId,
            message,
            parts: [{ type: "text", text: message }],
            userType: UserTypeEnum.Agent,
          },
        });
        logger.info(
          `Added assistant message to conversation ${conversationId}`,
        );
      }

      // 2. Send to channel (skip for web - web uses websocket)
      if (channel !== "web") {
        const handler = getChannel(channel);

        // Determine recipient based on channel
        let replyTo: string | undefined;
        const metadata: Record<string, string> = {
          workspaceId,
        };

        if (channel === "whatsapp") {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { phoneNumber: true },
          });
          replyTo = user?.phoneNumber ?? undefined;
        } else if (channel === "slack") {
          const slackAccount = await prisma.integrationAccount.findFirst({
            where: {
              integratedById: userId,
              integrationDefinition: { slug: "slack" },
              isActive: true,
              deleted: null,
            },
            select: { accountId: true },
          });
          replyTo = slackAccount?.accountId ?? undefined;

          if (channelMetadata?.slackChannel) {
            metadata.slackChannel = channelMetadata.slackChannel as string;
          }
          if (channelMetadata?.threadTs) {
            metadata.threadTs = channelMetadata.threadTs as string;
          }
        } else if (channel === "email") {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });
          replyTo = user?.email ?? undefined;
          metadata.subject = "Update from background task";
        }

        if (replyTo) {
          await handler.sendReply(replyTo, message, metadata);
          logger.info(`Sent ${channel} message to user ${userId}`);
        } else {
          logger.warn(`No recipient found for channel ${channel}`, { userId });
          return {
            success: false,
            error: `No recipient found for channel ${channel}`,
          };
        }
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error("HttpOrchestratorTools: failed to send channel message", {
        error,
        channel,
        userId,
      });
      return { success: false, error: errorMsg };
    }
  }
}
