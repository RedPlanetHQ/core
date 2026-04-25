import { prisma } from "~/db.server";

/**
 * BrowserSession records a task's claim on a gateway-side browser session
 * alias. Created on a successful `browser_create_session` tool call by the
 * agent. The row is the audit trail — actual exclusivity is enforced at
 * launch time by Chromium's `SingletonLock` on the profile's `userDataDir`.
 *
 * Rows are kept as history (never deleted on task completion).
 */

export async function createBrowserSession(params: {
  workspaceId: string;
  taskId: string;
  gatewayId: string;
  sessionName: string;
  profileName: string;
}) {
  // Idempotent: a single task creating the same session twice should not
  // produce duplicate rows.
  const existing = await prisma.browserSession.findFirst({
    where: {
      taskId: params.taskId,
      gatewayId: params.gatewayId,
      sessionName: params.sessionName,
    },
    select: { id: true },
  });
  if (existing) {
    return prisma.browserSession.findUniqueOrThrow({
      where: { id: existing.id },
    });
  }
  return prisma.browserSession.create({
    data: {
      workspaceId: params.workspaceId,
      taskId: params.taskId,
      gatewayId: params.gatewayId,
      sessionName: params.sessionName,
      profileName: params.profileName,
    },
  });
}

export async function getBrowserSessionsForTask(
  taskId: string,
  workspaceId: string,
) {
  return prisma.browserSession.findMany({
    where: { taskId, workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      sessionName: true,
      profileName: true,
      taskId: true,
      gatewayId: true,
      gateway: { select: { id: true, name: true } },
    },
  });
}

export type BrowserSessionListItem = Awaited<
  ReturnType<typeof getBrowserSessionsForTask>
>[number];

export async function deleteBrowserSession(id: string, workspaceId: string) {
  return prisma.browserSession.deleteMany({ where: { id, workspaceId } });
}

export async function hasBrowserSessions(
  taskId: string,
  workspaceId: string,
): Promise<boolean> {
  const count = await prisma.browserSession.count({
    where: { taskId, workspaceId },
  });
  return count > 0;
}
