import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { IntegrationEventType } from "@redplanethq/sdk";
import { prisma } from "~/db.server";
import { logger } from "./logger.service";
import { runIntegrationTrigger } from "./integration.server";
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

    let integrationAccounts: (IntegrationAccount & {
      integrationDefinition: IntegrationDefinitionV2;
    })[] = [];

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

          let accountIds: string[] = [];

          // Handle new CLI message format response
          if (identifyResponse?.success && identifyResponse?.result) {
            // Check if there are identifiers in the response
            if (
              identifyResponse.result.identifiers &&
              identifyResponse.result.identifiers.length > 0
            ) {
              accountIds = identifyResponse.result.identifiers.map(
                (identifier: any) => identifier.id,
              );
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
              accountIds = [];
            } else if (identifyResponse) {
              accountIds = [identifyResponse];
            }
          }

          if (accountIds.length > 0) {
            integrationAccounts = await prisma.integrationAccount.findMany({
              where: { accountId: { in: accountIds } },
              include: { integrationDefinition: true },
            });

            logger.info("Found integration accounts for webhook", {
              accountIds,
              integrationAccountIds: integrationAccounts.map((acc) => acc.id),
              count: integrationAccounts.length,
              sourceName,
            });
          } else {
            logger.warn("No account IDs found from IDENTIFY command", {
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
      const account = await prisma.integrationAccount.findUnique({
        where: { id: integrationAccountId },
        include: { integrationDefinition: true },
      });
      if (account) integrationAccounts = [account];
    }

    // Process webhook for all identified accounts in background
    if (integrationAccounts.length > 0) {
      // Fire and forget - don't await
      this.processWebhooksForAccounts(
        sourceName,
        integrationAccounts,
        eventHeaders,
        eventBody,
      ).catch((error) => {
        logger.error(`Background webhook processing failed for ${sourceName}`, {
          error,
        });
      });
    } else {
      logger.log(
        `Could not find integration accounts for webhook ${sourceName}`,
        {
          where: "WebhookService.handleEvents",
        },
      );
    }

    return { status: "acknowledged" };
  }

  private async processWebhooksForAccounts(
    sourceName: string,
    integrationAccounts: (IntegrationAccount & {
      integrationDefinition: IntegrationDefinitionV2;
    })[],
    eventHeaders: EventHeaders,
    eventBody: EventBody,
  ): Promise<void> {
    // Process webhooks for each account in parallel
    await Promise.all(
      integrationAccounts.map(async (integrationAccount) => {
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
              activitiesCreated:
                processResponse.result?.activities?.length || 0,
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
      }),
    );
  }
}

export const webhookService = new WebhookService();
