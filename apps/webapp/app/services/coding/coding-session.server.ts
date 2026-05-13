import { prisma } from "~/db.server";

export async function createCodingSession(params: {
  workspaceId: string;
  userId: string;
  taskId?: string;
  conversationId?: string;
  gatewayId?: string;
  agent: string;
  prompt?: string;
  dir?: string;
  externalSessionId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}) {
  // If we already have a row for this externalSessionId in this
  // workspace, treat the call as a resume — bump updatedAt and refresh
  // the latest prompt/dir/worktree fields rather than inserting a
  // duplicate. The gateway re-emits the same sessionId every time we
  // resume the session, so the unfiltered create here was producing one
  // CodingSession row per coding_ask call.
  if (params.externalSessionId) {
    const existing = await prisma.codingSession.findFirst({
      where: {
        workspaceId: params.workspaceId,
        externalSessionId: params.externalSessionId,
      },
      select: { id: true },
    });
    if (existing) {
      // Resume — only refresh prompt and let @updatedAt bump itself.
      // taskId / conversationId / gatewayId / agent / dir / worktree*
      // are session-scoped and don't change across resumes.
      return prisma.codingSession.update({
        where: { id: existing.id },
        data: { prompt: params.prompt },
      });
    }
  }

  return prisma.codingSession.create({
    data: {
      workspaceId: params.workspaceId,
      userId: params.userId,
      taskId: params.taskId,
      conversationId: params.conversationId,
      gatewayId: params.gatewayId,
      agent: params.agent,
      prompt: params.prompt,
      dir: params.dir,
      externalSessionId: params.externalSessionId,
      worktreePath: params.worktreePath,
      worktreeBranch: params.worktreeBranch,
    },
  });
}

export async function getCodingSessionsForTask(
  taskId: string,
  workspaceId: string,
) {
  return prisma.codingSession.findMany({
    where: { taskId, workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      agent: true,
      prompt: true,
      dir: true,
      externalSessionId: true,
      conversationId: true,
      gatewayId: true,
      worktreePath: true,
      worktreeBranch: true,
      gateway: { select: { id: true, name: true } },
    },
  });
}

export type CodingSessionListItem = Awaited<
  ReturnType<typeof getCodingSessionsForTask>
>[number];

export async function getLastCodingSession(
  taskId: string,
  workspaceId: string,
) {
  return prisma.codingSession.findFirst({
    where: { taskId, workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      externalSessionId: true,
      agent: true,
      dir: true,
      worktreePath: true,
      worktreeBranch: true,
      gateway: { select: { id: true, name: true } },
    },
  });
}

export async function hasCodingSessions(
  taskId: string,
  workspaceId: string,
): Promise<boolean> {
  const count = await prisma.codingSession.count({
    where: { taskId, workspaceId },
  });
  return count > 0;
}

export async function updateCodingSessionExternalId(
  id: string,
  workspaceId: string,
  externalSessionId: string,
) {
  return prisma.codingSession.update({
    where: { id, workspaceId },
    data: { externalSessionId },
  });
}
