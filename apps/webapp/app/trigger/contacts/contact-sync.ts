import { schedules } from "@trigger.dev/sdk";
import { prisma } from "~/db.server";
import { processContactSync } from "~/jobs/contacts/contact-sync.logic";
import { logger } from "~/services/logger.service";
import { initializeProvider } from "../utils/provider";

export const contactSyncSchedule = schedules.task({
  id: "contact-sync",
  cron: "0 2 * * *", // daily at 02:00 UTC
  maxDuration: 3600,
  run: async () => {
    await initializeProvider();
    const workspaces = await prisma.workspace.findMany({
      include: { UserWorkspace: { include: { user: true } } },
    });
    for (const workspace of workspaces) {
      for (const uw of workspace.UserWorkspace) {
        const user = uw.user;
        if (!user) continue;
        try {
          await processContactSync({
            userId: uw.userId,
            workspaceId: workspace.id,
            userName: user.name ?? user.email ?? "the user",
          });
        } catch (error) {
          // Isolate per-user failures so one bad user/workspace does not
          // abort the entire nightly sync.
          logger.error("Contact sync failed for user", {
            userId: uw.userId,
            workspaceId: workspace.id,
            error,
          });
        }
      }
    }
  },
});
