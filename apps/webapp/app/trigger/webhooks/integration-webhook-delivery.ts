import { queue, task } from "@trigger.dev/sdk";
import { logger } from "~/services/logger.service";
import {
  deliverWebhook,
  type WebhookEventType,
  type WebhookTarget,
} from "./webhook-delivery-utils";
import { prisma } from "~/db.server";

const integrationWebhookQueue = queue({
  name: "integration-webhook-queue",
});

interface OAuthIntegrationWebhookPayload {
  integrationAccountId: string;
  eventType: WebhookEventType;
  userId: string;
  workspaceId: string;
}

export const integrationWebhookTask = task({
  id: "integration-webhook-delivery",
  queue: integrationWebhookQueue,
  run: async (payload: OAuthIntegrationWebhookPayload) => {
    try {
      logger.log(
        `Processing OAuth integration webhook delivery for integration account ${payload.integrationAccountId}`,
      );

      // Get the integration account details
      const integrationAccount = await prisma.integrationAccount.findUnique({
        where: { id: payload.integrationAccountId },
        include: {
          integrationDefinition: true,
        },
      });

      let webhookPayload: any = {};

      if (
        !integrationAccount &&
        payload.eventType === "integration.disconnected"
      ) {
        webhookPayload = {
          event: payload.eventType,
          user_id: payload.userId,
          integration: {
            id: payload.integrationAccountId,
          },
        };
      } else if (!integrationAccount) {
        logger.error(
          `Integration account ${payload.integrationAccountId} not found`,
        );
        return { success: false, error: "Integration account not found" };
      } else {
        const integrationConfig =
          integrationAccount.integrationConfiguration as any;

        const integrationSpec = integrationAccount.integrationDefinition
          .spec as any;
        let mcpEndpoint = undefined;

        if (integrationSpec.mcp) {
          mcpEndpoint = `${process.env.API_BASE_URL}/api/v1/mcp/${integrationAccount.integrationDefinition.slug}`;
        } else if (integrationSpec.mcp.type === "stdio") {
          mcpEndpoint = `${process.env.API_BASE_URL}/api/v1/mcp/${integrationAccount.integrationDefinition.slug}`;
        }

        // Prepare webhook payload
        webhookPayload = {
          event: payload.eventType,
          user_id: payload.userId,
          integration: {
            id: integrationAccount.id,
            provider: integrationAccount.integrationDefinition.slug,
            mcpEndpoint: mcpEndpoint,
            name: integrationAccount.integrationDefinition.name,
            icon: integrationAccount.integrationDefinition.icon,
          },
          timestamp: new Date().toISOString(),
        };
      }

      // Get all OAuth clients that:
      // 1. Have integration scope granted for this user
      // 2. Have webhook URLs configured
      const oauthClients = await prisma.oAuthClientInstallation.findMany({
        where: {
          workspaceId: payload.workspaceId,
          installedById: payload.userId,
          isActive: true,
          grantedScopes: {
            contains: "integration",
          },
          oauthClient: {
            clientType: "regular",
          },
        },
        select: {
          id: true,
          oauthClient: {
            select: {
              clientId: true,
              webhookUrl: true,
              webhookSecret: true,
            },
          },
        },
      });

      logger.log(`Found ${oauthClients.length} OAuth clients`);

      if (oauthClients.length === 0) {
        logger.log(
          `No OAuth clients with integration scope found for user ${payload.userId}`,
        );
        return { success: true, message: "No OAuth clients to notify" };
      }

      // Convert OAuth clients to targets
      const targets: WebhookTarget[] = oauthClients
        .filter((client) => client.oauthClient?.webhookUrl)
        .map((client) => ({
          url: `${client.oauthClient?.webhookUrl}`,
          secret: client.oauthClient?.webhookSecret,
          accountId: client.id,
        }));

      // Use common delivery function
      const result = await deliverWebhook({
        payload: webhookPayload,
        targets,
        eventType: payload.eventType,
      });

      const successfulDeliveries = result.summary.successful;
      const totalDeliveries = result.summary.total;

      logger.log(
        `OAuth integration webhook delivery completed: ${successfulDeliveries}/${totalDeliveries} successful`,
      );

      return {
        success: result.success,
        deliveryResults: result.deliveryResults,
        summary: {
          total: totalDeliveries,
          successful: successfulDeliveries,
          failed: totalDeliveries - successfulDeliveries,
        },
      };
    } catch (error) {
      logger.error(
        `Failed to process OAuth integration webhook delivery for integration account ${payload.integrationAccountId}:`,
        { error: error instanceof Error ? error.message : String(error) },
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Helper function to trigger OAuth integration webhook delivery
export async function triggerIntegrationWebhook(
  integrationAccountId: string,
  userId: string,
  eventType: WebhookEventType,
  workspaceId: string,
) {
  try {
    await integrationWebhookTask.trigger({
      integrationAccountId,
      userId,
      eventType,
      workspaceId,
    });
    logger.log(
      `Triggered OAuth integration webhook delivery for integration account ${integrationAccountId}`,
    );
  } catch (error: any) {
    logger.error(
      `Failed to trigger OAuth integration webhook delivery for integration account ${integrationAccountId}:`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}
