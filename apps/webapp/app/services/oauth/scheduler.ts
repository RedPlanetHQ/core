import { logger, schedules } from "@trigger.dev/sdk/v3";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { integrationRunSchedule } from "~/trigger/integrations/integration-run-schedule";

export const scheduler = async (payload: { integrationAccountId: string }) => {
  const { integrationAccountId } = payload;

  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: { id: integrationAccountId, deleted: null },
    include: {
      integrationDefinition: true,
      workspace: true,
    },
  });

  if (!integrationAccount) {
    logger.error("Integration account not found");
    return null;
  }

  if (!integrationAccount.workspace) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = integrationAccount.integrationDefinition.spec as any;

  if (
    spec.schedule &&
    spec.schedule.frequency &&
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
        },
      },
    });

    return createdSchedule;
  } else {
    await prisma.integrationAccount.update({
      where: {
        id: integrationAccount.id,
      },
      data: {
        settings: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(integrationAccount.settings as any),
        },
      },
    });
  }

  return "No schedule for this task";
};
