import { EpisodeTypeEnum, type Message } from "@core/types";
import { addToQueue } from "./queue";
import { triggerWebhookDelivery } from "../webhooks/webhook-delivery";
import { logger } from "@trigger.dev/sdk";
import { prisma } from "~/db.server";
import { enqueueActivityCase } from "~/lib/queue-adapter.server";

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

  const results = await Promise.all(
    messages.map(async (message) => {
      const activity = await prisma.activity.create({
        data: {
          text: message.data.text,
          sourceURL: message.data.sourceURL,
          integrationAccountId,
          workspaceId: integrationAccount?.workspaceId,
        },
      });

      if (integrationAccount?.workspaceId) {
        try {
          await triggerWebhookDelivery(
            activity.id,
            integrationAccount?.workspaceId,
          );
          logger.debug("Webhook delivery triggered for activity", {
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
        text: message.data.text as string,
      };
    }),
  );

  // Enqueue CASE pipeline if integration account has autoActivityRead enabled
  try {
    const accountSettings = integrationAccount.settings as Record<
      string,
      unknown
    > | null;

    if (accountSettings?.autoActivityRead) {
      const user = await prisma.user.findUnique({
        where: { id: integrationAccount.integratedById },
        select: { email: true },
      });

      if (user?.email) {
        const activitiesText = results.map((r) => r.text).join("\n\n");
        await enqueueActivityCase({
          integrationAccountId,
          accountId: integrationAccount.accountId ?? integrationAccountId,
          workspaceId: integrationAccount.workspaceId,
          userId: integrationAccount.integratedById,
          userEmail: user.email,
          integrationSlug: integrationAccount.integrationDefinition.slug,
          activitiesText,
          timezone: "UTC",
        });
      }
    }
  } catch (error) {
    logger.error("Failed to enqueue activity case", {
      integrationAccountId,
      error,
    });
  }

  return results;
};
