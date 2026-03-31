import { prisma } from "~/db.server";
import type { Page } from "@prisma/client";

/**
 * Find or create a daily Page record for a given workspaceId, userId, and calendar date.
 * The date is normalized to midnight UTC so uniqueness works correctly.
 */
export async function findOrCreateDailyPage(
  workspaceId: string,
  userId: string,
  date: Date,
): Promise<Page> {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);

  return prisma.page.upsert({
    where: {
      workspaceId_userId_date: {
        workspaceId,
        userId,
        date: normalized,
      },
    },
    create: {
      workspaceId,
      userId,
      date: normalized,
    },
    update: {},
  });
}

export async function getPageById(id: string): Promise<Page | null> {
  return prisma.page.findUnique({ where: { id } });
}

export async function updatePageContent(
  id: string,
  description: string,
  descriptionBinary?: Buffer,
): Promise<Page> {
  return prisma.page.update({
    where: { id },
    data: {
      description,
      ...(descriptionBinary && { descriptionBinary }),
    },
  });
}
