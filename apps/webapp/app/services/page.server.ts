import { prisma } from "~/db.server";
import type { Page } from "@prisma/client";
import { DateTime } from "luxon";

/**
 * Returns midnight UTC for the calendar date that corresponds to
 * "today" in the given IANA timezone.
 *
 * Example: timezone="Asia/Kolkata" at 00:03 IST on 2026-04-08
 *   UTC instant is 2026-04-07T18:33Z → returns new Date("2026-04-08T00:00:00.000Z")
 *
 * Falls back to the UTC calendar date when the timezone string is invalid.
 *
 * @param timezone  IANA timezone string (e.g. "Asia/Kolkata").
 * @param now       Overridable current instant, defaults to new Date(). Useful in tests.
 */
export function todayUTCMidnightInTimezone(
  timezone: string,
  now: Date = new Date(),
): Date {
  const dt = DateTime.fromJSDate(now).setZone(timezone);
  const dateStr = dt.isValid
    ? dt.toFormat("yyyy-MM-dd")
    : DateTime.fromJSDate(now).toUTC().toFormat("yyyy-MM-dd");
  return new Date(`${dateStr}T00:00:00.000Z`);
}

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

export async function findOrCreateTaskPage(
  workspaceId: string,
  userId: string,
  taskId: string,
): Promise<Page> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { pageId: true },
  });

  if (task?.pageId) {
    const existing = await prisma.page.findUnique({ where: { id: task.pageId } });
    if (existing) return existing;
  }

  const page = await prisma.page.create({
    data: { workspaceId, userId, type: "Task" },
  });

  await prisma.task.update({ where: { id: taskId }, data: { pageId: page.id } });
  return page;
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
