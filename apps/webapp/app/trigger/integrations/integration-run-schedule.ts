import { PrismaClient } from "@prisma/client";
import { IntegrationEventType } from "@core/types";
import { logger, schedules, tasks } from "@trigger.dev/sdk/v3";

import { type integrationRun } from "./integration-run";
import { getOrCreatePersonalAccessToken } from "../utils/utils";
import { nanoid } from "nanoid";

const prisma = new PrismaClient();

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
      logger.info("No integration account found");
      return deletedSchedule;
    }

    if (!integrationAccount.workspace.userId) {
      logger.info("No workspace user id found");
      return null;
    }

    const pat = await getOrCreatePersonalAccessToken({
      name: `integration_scheduled_${nanoid(10)}`,
      userId: integrationAccount.workspace.userId as string,
    });

    if (!pat || !pat.token) {
      logger.info("No pat token found");
      return null;
    }

    return await tasks.trigger<typeof integrationRun>("integration-run", {
      event: IntegrationEventType.SYNC,
      pat: pat.token,
      patId: pat.id,
      integrationAccount,
      integrationDefinition: integrationAccount.integrationDefinition,
    });
  },
});
