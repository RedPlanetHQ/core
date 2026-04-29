/**
 * Quick Chat conversation resolution for the desktop voice widget.
 *
 * One persistent conversation per user, source: "voice". Each Option+Option
 * invocation appends to it. Created lazily on first turn.
 */

import { prisma } from "~/db.server";

const VOICE_SOURCE = "voice";

export async function getOrCreateQuickChat(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      userId,
      source: VOICE_SOURCE,
      deleted: null,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      source: VOICE_SOURCE,
      title: "Quick Chat",
    },
    select: { id: true },
  });

  return created.id;
}
