import { IntegrationEventType } from "@core/types";
import { logger, schedules, tasks } from "@trigger.dev/sdk/v3";

import { type integrationRun } from "./integration-run";
import { prisma } from "~/db.server";

export const integrationRunSchedule = schedules.task({
  id: "integration-run-schedule",
  run: async (payload) => {
    const { externalId } = payload;
    if (!externalId) {
      logger.info("No externalId provided");
      return null;
    }

    const integrationAccount = await prisma.integrationAccount.findUnique({
      where: { id: externalId },
      include: {
        integrationDefinition: true,
        workspace: true,
      },
    });

    if (!integrationAccount) {
      const deletedSchedule = await schedules.del(externalId);
      logger.info("No integration account found, deleting schedule");
      return deletedSchedule;
    }

    if (!integrationAccount.workspace.userId) {
      logger.info("No workspace user id found");
      return null;
    }

    logger.info("Triggering scheduled integration run", {
      integrationId: integrationAccount.integrationDefinition.id,
      integrationSlug: integrationAccount.integrationDefinition.slug,
      accountId: integrationAccount.id,
    });

    return await tasks.trigger<typeof integrationRun>("integration-run", {
      event: IntegrationEventType.SYNC,
      integrationAccount,
      integrationDefinition: integrationAccount.integrationDefinition,
      eventBody: {
        scheduled: true,
        scheduledAt: new Date().toISOString(),
      },
    });
  },
});
