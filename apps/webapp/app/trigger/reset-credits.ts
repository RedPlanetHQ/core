import { schedules } from "@trigger.dev/sdk";
import { prisma } from "./utils/prisma";
import { resetMonthlyCredits } from "./utils/utils";

//
export const runCredits = schedules.task({
  id: "reset-credits",
  maxDuration: 3000,
  cron: "0 0 1 * *",
  run: async () => {
    const workspaces = await prisma.workspace.findMany({});

    for await (const workspace of workspaces) {
      await resetMonthlyCredits(workspace.id);
    }
  },
});
