/**
 * Quick Chat conversation resolution for the desktop voice widget.
 *
 * One conversation per user per day, source: "voice". Each Option+Option
 * invocation (and any inbox.summarise) appends to that day's chat. Created
 * lazily on first turn. Day boundary uses the same server-local
 * setHours(0,0,0,0) pattern as the WhatsApp daily-conversation flow in
 * message-processor.ts.
 */

import { prisma } from "~/db.server";

const VOICE_SOURCE = "voice";

export async function getOrCreateQuickChat(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      userId,
      source: VOICE_SOURCE,
      deleted: null,
      createdAt: { gte: todayStart },
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
