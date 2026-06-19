import { schedules } from "@trigger.dev/sdk";
import { prisma } from "~/db.server";
import { processContactSync } from "~/jobs/contacts/contact-sync.logic";
import { initializeProvider } from "../utils/provider";

export const contactSyncSchedule = schedules.task({
  id: "contact-sync",
  cron: "0 2 * * *", // daily at 02:00 UTC
  maxDuration: 3600,
  run: async () => {
    await initializeProvider();
    const workspaces = await prisma.workspace.findMany({
      include: { UserWorkspace: true },
    });
    for (const workspace of workspaces) {
      for (const uw of workspace.UserWorkspace) {
        const user = await prisma.user.findUnique({ where: { id: uw.userId } });
        if (!user) continue;
        await processContactSync({
          userId: uw.userId,
          workspaceId: workspace.id,
          userName: user.name ?? user.email ?? "the user",
        });
      }
    }
  },
});
