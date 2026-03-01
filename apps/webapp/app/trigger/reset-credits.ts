import { schedules } from "@trigger.dev/sdk";
import { prisma } from "~/db.server";
import { resetMonthlyCredits } from "./utils/utils";

// reset credits for all users
export const runCredits = schedules.task({
  id: "reset-credits",
  maxDuration: 3000,
  cron: "0 0 1 * *",
  run: async () => {
    const workspaces = await prisma.workspace.findMany({
      include: {
        UserWorkspace: true,
      },
    });

    for await (const workspace of workspaces) {
      for await (const uw of workspace.UserWorkspace) {
        await resetMonthlyCredits(workspace.id, uw.userId);
      }
    }
  },
});
