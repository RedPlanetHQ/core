import { logger, schedules } from "@trigger.dev/sdk/v3";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { integrationRunSchedule } from "~/trigger/integrations/integration-run-schedule";
import { isBillingEnabled, isPaidPlan } from "~/config/billing.server";

export const scheduler = async (payload: {
  integrationAccountId: string;
  admin: boolean;
}) => {
  const { integrationAccountId, admin } = payload;

  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: { id: integrationAccountId, deleted: null },
    include: {
      integrationDefinition: true,
      workspace: {
        include: {
          Subscription: true,
        },
      },
    },
  });

  if (!integrationAccount) {
    logger.error("Integration account not found");
    return null;
  }

  if (!integrationAccount.workspace) {
    return null;
  }

  // Check if auto-read is available for this workspace's plan
  if (isBillingEnabled() && !admin) {
    const planType =
      integrationAccount.workspace.Subscription?.planType || "FREE";

    if (!isPaidPlan(planType)) {
      logger.warn("Auto-read requires a paid plan", {
        workspaceId: integrationAccount.workspace.id,
        planType,
      });
      return { error: "Auto-read requires a Pro or Max plan" };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = integrationAccount.integrationDefinition.spec as any;

  if (
    spec.schedule &&
    spec.schedule.frequency &&
    spec.enableAutoRead &&
    env.QUEUE_PROVIDER === "trigger"
  ) {
    const createdSchedule = await schedules.create({
      // The id of the scheduled task you want to attach to.
      task: integrationRunSchedule.id,
      // The schedule in cron format.
      cron: "*/15 * * * *",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // timezone: (integrationAccount.workspace.preferences as any).timezone,
      // this is required, it prevents you from creating duplicate schedules. It will update the schedule if it already exists.
      deduplicationKey: integrationAccount.id,
      externalId: integrationAccount.id,
    });

    await prisma.integrationAccount.update({
      where: {
        id: integrationAccount.id,
      },
      data: {
        settings: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(integrationAccount.settings as any),
          scheduleId: createdSchedule.id,
          autoActivityRead: true,
        },
      },
    });

    return createdSchedule;
  }

  return "No schedule for this task";
};

export const unschedule = async (payload: { integrationAccountId: string }) => {
  const { integrationAccountId } = payload;

  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: { id: integrationAccountId },
    select: { settings: true },
  });

  if (!integrationAccount) {
    return null;
  }

  const settings = (integrationAccount.settings as Record<string, any>) || {};

  if (settings.scheduleId && env.QUEUE_PROVIDER === "trigger") {
    try {
      await schedules.del(settings.scheduleId);
    } catch {
      logger.error("Failed to delete schedule", {
        scheduleId: settings.scheduleId,
      });
    }
  }

  await prisma.integrationAccount.update({
    where: { id: integrationAccountId },
    data: {
      settings: {
        ...settings,
        scheduleId: undefined,
        autoActivityRead: false,
      },
    },
  });
};

/**
 * Unschedule all auto-read schedules for a workspace
 * Used when a workspace is downgraded to a free plan
 */
export const unscheduleAllForWorkspace = async (workspaceId: string) => {
  const integrationAccounts = await prisma.integrationAccount.findMany({
    where: {
      workspaceId,
      deleted: null,
    },
    select: {
      id: true,
      settings: true,
    },
  });

  const accountsWithAutoRead = integrationAccounts.filter((account) => {
    const settings = (account.settings as Record<string, any>) || {};
    return settings.autoActivityRead === true;
  });

  logger.info("Unscheduling auto-read for downgraded workspace", {
    workspaceId,
    accountCount: accountsWithAutoRead.length,
  });

  for (const account of accountsWithAutoRead) {
    try {
      await unschedule({ integrationAccountId: account.id });
    } catch (error) {
      logger.error("Failed to unschedule account", {
        accountId: account.id,
        error,
      });
    }
  }

  return { unscheduledCount: accountsWithAutoRead.length };
};
