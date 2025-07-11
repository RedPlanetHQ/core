import { PrismaClient } from "@prisma/client";
import { logger, schedules, task } from "@trigger.dev/sdk/v3";

import { integrationRunSchedule } from "./integration-run-schedule";

const prisma = new PrismaClient();

export const scheduler = task({
  id: "scheduler",
  run: async (payload: { integrationAccountId: string }) => {
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

    if (spec.schedule && spec.schedule.frequency) {
      const createdSchedule = await schedules.create({
        // The id of the scheduled task you want to attach to.
        task: integrationRunSchedule.id,
        // The schedule in cron format.
        cron: spec.schedule.frequency,
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
    }

    return "No schedule for this task";
  },
});
