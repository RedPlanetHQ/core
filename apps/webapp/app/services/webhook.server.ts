import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { prisma } from "~/db.server";
import { logger } from "./logger.service";
import { IntegrationRunner } from "~/services/integrations/integration-runner";
import { webhookDeliveryTask } from "../trigger/webhooks/webhook-delivery";
import { env } from "~/env.server";

export type EventHeaders = Record<string, string | string[]>;
export type EventBody = Record<string, any>;

export class WebhookService {
  async handleEvents(
    sourceName: string,
    integrationAccountId: string | undefined,
    eventHeaders: EventHeaders,
    eventBody: EventBody,
    rawBody?: string,
  ): Promise<{ challenge?: string; status: string }> {
    logger.debug(`Received webhook ${sourceName}`, {
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
          const messages = await IntegrationRunner.identify({
            webhookData: {
              eventHeaders,
              event: { ...eventBody },
              rawBody,
            },
            integrationDefinition,
          });

          const identifyResult =
            IntegrationRunner.handleIdentifyMessages(messages);
          const accountIds = identifyResult.identifiers.map((id) => id.id);

          if (accountIds.length > 0) {
            integrationAccounts = await prisma.integrationAccount.findMany({
              where: { accountId: { in: accountIds } },
              include: { integrationDefinition: true },
            });

            logger.debug("Found integration accounts for webhook", {
              accountIds,
              integrationAccountIds: integrationAccounts.map((acc) => acc.id),
              count: integrationAccounts.length,
              sourceName,
            });
          } else {
            logger.warn("No account IDs found from IDENTIFY command", {
              sourceName,
              response: identifyResult,
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
      logger.debug(
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
          // Skip if the user has not enabled automatic activity reading
          const autoActivityRead = (
            integrationAccount.settings as Record<string, unknown> | null
          )?.autoActivityRead;
          if (!autoActivityRead) {
            logger.debug(
              `Skipping webhook for ${sourceName} — autoActivityRead not enabled`,
              { integrationAccountId: integrationAccount.id },
            );
            return;
          }

          logger.debug(`Processing webhook for ${sourceName}`, {
            integrationAccountId: integrationAccount.id,
            integrationSlug: integrationAccount.integrationDefinition.slug,
          });

          if (env.QUEUE_PROVIDER === "trigger") {
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
          }

          const messages = await IntegrationRunner.process({
            eventData: {
              eventHeaders,
              eventData: { ...eventBody },
            },
            config: integrationAccount.integrationConfiguration as any,
            integrationDefinition: integrationAccount.integrationDefinition,
            state: (integrationAccount.settings as any)?.state,
          });

          const processResult = await IntegrationRunner.handleProcessMessages(
            messages,
            integrationAccount.id,
          );

          logger.debug(`Successfully processed webhook for ${sourceName}`, {
            integrationAccountId: integrationAccount.id,
            activitiesCreated: processResult.activities?.length || 0,
            messagesProcessed: messages.length,
          });
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
