/**
 * DirectOrchestratorTools
 *
 * Implementation that calls gateway HTTP APIs + DB directly. Used in the
 * in-process (non-Trigger) web chat server context.
 */

import { searchMemoryWithAgent } from "../memory";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { listGateways } from "~/services/gateway.server";
import {
  handleGetIntegrationActions,
  handleExecuteIntegrationAction,
} from "~/utils/mcp/integration-operations";
import { callTool } from "~/services/gateway/transport.server";
import { prisma } from "~/db.server";
import { logger } from "../../logger.service";
import { getChannel } from "~/services/channels";
import { UserTypeEnum } from "@core/types";
import {
  OrchestratorTools,
  type ConnectedIntegration,
  type GatewayAgentInfo,
  type SendChannelMessageParams,
  type SendChannelMessageResult,
} from "./base";

export class DirectOrchestratorTools extends OrchestratorTools {
  async searchMemory(
    query: string,
    userId: string,
    workspaceId: string,
    source: string,
  ): Promise<string> {
    try {
      const result = await searchMemoryWithAgent(
        query,
        userId,
        workspaceId,
        source,
        {
          structured: false,
        },
      );
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
    const gateways = await listGateways(workspaceId);
    return gateways.map((gw) => {
      return {
        id: gw.id,
        name: gw.name,
        description: gw.description || `Gateway: ${gw.name}`,
        // Tool names aren't cached on the row anymore; live-fetch happens
        // when the agent is created.
        tools: [],
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
    return callTool(gatewayId, toolName, params, 60000);
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
          // Get user's phone number
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { phoneNumber: true },
          });
          replyTo = user?.phoneNumber ?? undefined;
        } else if (channel === "slack") {
          // Get user's Slack ID from integration account
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

          // Add thread context if available
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
      logger.error("Failed to send channel message", {
        error,
        channel,
        userId,
      });
      return { success: false, error: errorMsg };
    }
  }
}
