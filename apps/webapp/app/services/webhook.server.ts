import {
  type IntegrationDefinitionV2,
  type IntegrationAccount,
} from "@core/database";
import { IntegrationEventType } from "@redplanethq/sdk";
import { prisma } from "~/db.server";
import { logger } from "./logger.service";
import { runIntegrationTrigger } from "./integration.server";

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

    // Check if the event is a URL verification challenge (Slack)
    if (eventBody.type === "url_verification") {
      logger.log("Responding to Slack URL verification challenge");
      return { challenge: eventBody.challenge, status: "verified" };
    }

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
          const accountIdResponse = await runIntegrationTrigger(
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

          if (
            accountIdResponse?.message?.startsWith("The event payload type is")
          ) {
            accountId = undefined;
          } else {
            accountId = accountIdResponse;
          }

          if (accountId) {
            integrationAccount = await prisma.integrationAccount.findFirst({
              where: { accountId },
              include: { integrationDefinition: true },
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
        await runIntegrationTrigger(
          integrationAccount.integrationDefinition,
          {
            event: IntegrationEventType.PROCESS,
            integrationAccount,
            eventBody: {
              eventHeaders,
              eventData: { ...eventBody },
            },
          },
          integrationAccount.integratedById,
        );

        logger.log(`Successfully processed webhook for ${sourceName}`, {
          integrationAccountId: integrationAccount.id,
        });
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
