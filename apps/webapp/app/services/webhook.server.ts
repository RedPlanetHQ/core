import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { IntegrationEventType } from "@redplanethq/sdk";
import { prisma } from "~/db.server";
import { logger } from "./logger.service";
import { runIntegrationTrigger } from "./integration.server";
import { triggerWebhookDelivery } from "~/trigger/webhooks/webhook-delivery";
import { tasks } from "@trigger.dev/sdk";
import { webhookDeliveryTask } from "../trigger/webhooks/webhook-delivery";

export type EventHeaders = Record<string, string | string[]>;
export type EventBody = Record<string, any>;

export class WebhookService {
  async handleEvents(
    sourceName: string,
    integrationAccountId: string | undefined,
    eventHeaders: EventHeaders,
    eventBody: EventBody,
  ): Promise<{ challenge?: string; status: string }> {
    logger.log(`Received webhook ${sourceName}`, {
      where: "WebhookService.handleEvents",
    });

    let integrationAccount:
      | (IntegrationAccount & {
          integrationDefinition: IntegrationDefinitionV2;
        })
      | null = null;

    if (!integrationAccountId) {
      // Find integration account by identifying the webhook account
      const integrationDefinition =
        await prisma.integrationDefinitionV2.findFirst({
          where: { slug: sourceName, deleted: null },
        });

      if (integrationDefinition) {
        try {
          const identifyResponse = await runIntegrationTrigger(
            integrationDefinition,
            {
              event: IntegrationEventType.IDENTIFY,
              eventBody: {
                eventHeaders,
                event: { ...eventBody },
              },
            },
          );

          let accountId: string | undefined;

          // Handle new CLI message format response
          if (identifyResponse?.success && identifyResponse?.result) {
            // Check if there are identifiers in the response
            if (
              identifyResponse.result.identifiers &&
              identifyResponse.result.identifiers.length > 0
            ) {
              accountId = identifyResponse.result.identifiers[0].id;
            } else if (
              identifyResponse.result.activities &&
              identifyResponse.result.activities.length > 0
            ) {
              // Sometimes the account ID might be in activities data
              const firstActivity = identifyResponse.result.activities[0];
              accountId = firstActivity.accountId || firstActivity.id;
            } else {
              // Check raw output for backward compatibility
              accountId = identifyResponse.rawOutput?.trim();
            }
          } else if (identifyResponse?.error) {
            logger.warn("Integration IDENTIFY command failed", {
              error: identifyResponse.error,
              sourceName,
            });
          } else {
            // Handle legacy response format for backward compatibility
            if (
              identifyResponse?.message?.startsWith("The event payload type is")
            ) {
              accountId = undefined;
            } else {
              accountId = identifyResponse;
            }
          }

          if (accountId) {
            integrationAccount = await prisma.integrationAccount.findFirst({
              where: { accountId },
              include: { integrationDefinition: true },
            });

            logger.info("Found integration account for webhook", {
              accountId,
              integrationAccountId: integrationAccount?.id,
              sourceName,
            });
          } else {
            logger.warn("No account ID found from IDENTIFY command", {
              sourceName,
              response: identifyResponse,
            });
          }
        } catch (error) {
          logger.error("Failed to identify integration account", {
            error,
            sourceName,
          });
        }
      }
    } else {
      integrationAccount = await prisma.integrationAccount.findUnique({
        where: { id: integrationAccountId },
        include: { integrationDefinition: true },
      });
    }

    if (integrationAccount) {
      try {
        logger.info(`Processing webhook for ${sourceName}`, {
          integrationAccountId: integrationAccount.id,
          integrationSlug: integrationAccount.integrationDefinition.slug,
        });

        await webhookDeliveryTask.trigger(
          {
            workspaceId: integrationAccount.workspaceId,
            raw: true,
            rawBody: eventBody,
          },
          {
            tags: [integrationAccount.workspaceId, sourceName],
          },
        );

        const processResponse = await runIntegrationTrigger(
          integrationAccount.integrationDefinition,
          {
            event: IntegrationEventType.PROCESS,
            eventBody: {
              eventHeaders,
              eventData: { ...eventBody },
            },
          },
          integrationAccount.integratedById,
          integrationAccount.workspaceId,
          integrationAccount,
        );

        if (processResponse?.success) {
          logger.log(`Successfully processed webhook for ${sourceName}`, {
            integrationAccountId: integrationAccount.id,
            activitiesCreated: processResponse.result?.activities?.length || 0,
            messagesProcessed: processResponse.messages?.length || 0,
          });
        } else {
          logger.warn(`Webhook processing had issues for ${sourceName}`, {
            integrationAccountId: integrationAccount.id,
            error: processResponse?.error,
            success: processResponse?.success,
          });
        }
      } catch (error) {
        logger.error(`Failed to process webhook for ${sourceName}`, {
          error,
          integrationAccountId: integrationAccount.id,
        });
      }
    } else {
      logger.log(
        `Could not find integration account for webhook ${sourceName}`,
        {
          where: "WebhookService.handleEvents",
        },
      );
    }

    return { status: "acknowledged" };
  }
}

export const webhookService = new WebhookService();
