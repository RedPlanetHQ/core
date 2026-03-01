import { EpisodeTypeEnum, type Message } from "@core/types";
import { addToQueue } from "./queue";
import { triggerWebhookDelivery } from "../webhooks/webhook-delivery";
import { logger } from "@trigger.dev/sdk";
import { prisma } from "~/db.server";

export const createIntegrationAccount = async ({
  integrationDefinitionId,
  userId,
  accountId,
  config,
  settings,
  workspaceId,
}: {
  integrationDefinitionId: string;
  userId: string;
  accountId: string;
  workspaceId: string;
  config?: Record<string, any>;
  settings?: Record<string, any>;
}) => {
  return prisma.integrationAccount.upsert({
    where: {
      accountId_integrationDefinitionId_workspaceId: {
        accountId,
        integrationDefinitionId,
        workspaceId,
      },
    },
    update: {
      integrationConfiguration: config || {},
      settings: settings || {},
      isActive: true,
      deleted: null,
    },
    create: {
      accountId,
      integrationDefinitionId,
      integratedById: userId,
      integrationConfiguration: config || {},
      settings: settings || {},
      isActive: true,
      workspaceId,
    },
  });
};

export const saveMCPConfig = async ({
  integrationAccountId,
  config,
}: {
  integrationAccountId: string;
  config: any;
}) => {
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      id: integrationAccountId,
    },
  });

  if (!integrationAccount) {
    return [];
  }

  const integrationConfig = integrationAccount.integrationConfiguration as any;

  return prisma.integrationAccount.update({
    where: {
      id: integrationAccountId,
    },
    data: {
      integrationConfiguration: {
        ...integrationConfig,
        mcp: config,
      },
    },
  });
};

export const saveIntegrationAccountState = async ({
  messages,
  integrationAccountId,
}: {
  messages: Message[];
  integrationAccountId: string;
}) => {
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      id: integrationAccountId,
    },
  });

  const settings = integrationAccount?.settings as any;
  const state = settings.state;

  return Promise.all(
    messages.map(async (message) => {
      return await prisma.integrationAccount.update({
        where: {
          id: integrationAccountId,
        },
        data: {
          settings: {
            ...settings,
            state: {
              ...state,
              ...message.data,
            },
          },
        },
      });
    }),
  );
};

export const createActivities = async ({
  integrationAccountId,
  messages,
}: {
  integrationAccountId: string;
  messages: Message[];
  userId: string;
}) => {
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      id: integrationAccountId,
    },
    include: {
      integrationDefinition: true,
    },
  });

  if (!integrationAccount) {
    return [];
  }

  return await Promise.all(
    messages.map(async (message) => {
      const activity = await prisma.activity.create({
        data: {
          text: message.data.text,
          sourceURL: message.data.sourceURL,
          integrationAccountId,
          workspaceId: integrationAccount?.workspaceId,
        },
      });

      const ingestData = {
        episodeBody: message.data.text,
        referenceTime: new Date().toISOString(),
        source: integrationAccount?.integrationDefinition.slug,
        type: EpisodeTypeEnum.CONVERSATION,
      };

      const queueResponse = await addToQueue(
        ingestData,
        integrationAccount?.integratedById,
        activity.id,
      );

      if (integrationAccount?.workspaceId) {
        try {
          await triggerWebhookDelivery(
            activity.id,
            integrationAccount?.workspaceId,
          );
          logger.log("Webhook delivery triggered for activity", {
            activityId: activity.id,
          });
        } catch (error) {
          logger.error("Failed to trigger webhook delivery", {
            activityId: activity.id,
            error,
          });
        }
      }

      return {
        activityId: activity.id,
        queueId: queueResponse.id,
      };
    }),
  );
};
