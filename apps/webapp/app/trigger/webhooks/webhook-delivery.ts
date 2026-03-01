import { queue, task } from "@trigger.dev/sdk";
import { logger } from "~/services/logger.service";
import { WebhookDeliveryStatus } from "@core/database";
import {
  deliverWebhook,
  prepareWebhookTargets,
} from "./webhook-delivery-utils";
import { prisma } from "~/db.server";

const webhookQueue = queue({
  name: "webhook-delivery-queue",
});

interface WebhookDeliveryPayload {
  activityId?: string;
  workspaceId: string;
  raw?: boolean;
  rawBody?: any;
}

export const webhookDeliveryTask = task({
  id: "webhook-delivery",
  queue: webhookQueue,
  run: async (payload: WebhookDeliveryPayload) => {
    try {
      logger.log(
        `Processing webhook delivery for activity ${payload.activityId}`,
      );

      // Get active webhooks for this workspace
      const webhooks = await prisma.webhookConfiguration.findMany({
        where: {
          workspaceId: payload.workspaceId,
          isActive: true,
        },
        select: {
          id: true,
          url: true,
          secret: true,
        },
      });

      let webhookPayload;
      let oauthClients: Array<any> = [];

      if (payload.activityId) {
        oauthClients = await prisma.oAuthClientInstallation.findMany({
          where: {
            workspaceId: payload.workspaceId,
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

        // Get the activity data
        const activity = await prisma.activity.findUnique({
          where: { id: payload.activityId },
          include: {
            integrationAccount: {
              include: {
                integrationDefinition: true,
              },
            },
            workspace: true,
          },
        });

        if (!activity) {
          logger.error(`Activity ${payload.activityId} not found`);
          return { success: false, error: "Activity not found" };
        }

        if (webhooks.length === 0 && oauthClients.length === 0) {
          logger.log(
            `No active webhooks found for workspace ${payload.workspaceId}`,
          );
          return { success: true, message: "No webhooks to deliver to" };
        }

        // Prepare webhook payload
        webhookPayload = {
          event: "activity.created",
          timestamp: new Date().toISOString(),
          data: {
            id: activity.id,
            text: activity.text,
            sourceURL: activity.sourceURL,
            createdAt: activity.createdAt,
            updatedAt: activity.updatedAt,
            integrationAccount: activity.integrationAccount
              ? {
                  id: activity.integrationAccount.id,
                  integrationDefinition: {
                    name: activity.integrationAccount.integrationDefinition
                      .name,
                    slug: activity.integrationAccount.integrationDefinition
                      .slug,
                  },
                }
              : null,
            workspace: {
              id: activity.workspace.id,
              name: activity.workspace.name,
            },
          },
        };
      } else {
        webhookPayload = payload.rawBody;
      }

      // Convert webhooks to targets using common utils
      const targets = prepareWebhookTargets(
        [...webhooks, ...oauthClients].map((webhook) => ({
          url: "url" in webhook ? webhook.url : webhook.oauthClient.webhookUrl!,
          secret:
            "secret" in webhook
              ? webhook.secret
              : webhook.oauthClient.webhookSecret,
          id: webhook.id,
        })),
      );

      // Use common delivery function
      const result = await deliverWebhook({
        payload: webhookPayload,
        targets,
        eventType: "activity.created",
      });

      // Log delivery results to database using createMany for better performance
      const logEntries = webhooks
        .map((webhook, index) => {
          const deliveryResult = result.deliveryResults[index];
          if (!deliveryResult) return null;

          return {
            webhookConfigurationId: webhook.id,
            activityId: payload.activityId,
            status: deliveryResult.success
              ? WebhookDeliveryStatus.SUCCESS
              : WebhookDeliveryStatus.FAILED,
            responseStatusCode: deliveryResult.status,
            responseBody: deliveryResult.responseBody?.slice(0, 1000),
            error: deliveryResult.error,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (logEntries.length > 0) {
        try {
          await prisma.webhookDeliveryLog.createMany({
            data: logEntries,
          });
        } catch (error) {
          logger.error("Failed to log webhook deliveries", {
            error,
            count: logEntries.length,
          });
        }
      }

      const successCount = result.summary.successful;
      const totalCount = result.summary.total;

      logger.log(
        `Webhook delivery completed: ${successCount}/${totalCount} successful`,
      );

      return {
        success: result.success,
        delivered: successCount,
        total: totalCount,
        results: result.deliveryResults,
      };
    } catch (error: any) {
      logger.error(
        `Error in webhook delivery task for activity ${payload.activityId}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  },
});

// Helper function to trigger webhook delivery
export async function triggerWebhookDelivery(
  activityId: string,
  workspaceId: string,
) {
  try {
    await webhookDeliveryTask.trigger({
      activityId,
      workspaceId,
    });
    logger.log(`Triggered webhook delivery for activity ${activityId}`);
  } catch (error: any) {
    logger.error(
      `Failed to trigger webhook delivery for activity ${activityId}:`,
      error,
    );
  }
}
