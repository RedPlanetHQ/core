import { prisma } from "~/db.server";
import type { Task, TaskStatus } from "@prisma/client";
import {
  cancelTaskJob,
  removeScheduledTask,
  enqueueScheduledTask,
} from "~/lib/queue-adapter.server";
import { computeNextRun, checkShouldDeactivate } from "~/utils/schedule-utils";
import { DateTime } from "luxon";
import { logger } from "./logger.service";

// ============================================================================
// Interfaces
// ============================================================================

export interface ScheduledTaskData {
  title: string;
  description?: string;
  schedule?: string; // RRule string (in user's local timezone)
  nextRunAt?: Date; // For one-time scheduled tasks (computed if schedule provided)
  channel?: string; // Channel name or type
  channelId?: string | null; // FK to Channel table
  maxOccurrences?: number | null;
  endDate?: Date | null;
  startDate?: Date | null;
  parentTaskId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ScheduledTaskUpdateData {
  title?: string;
  description?: string;
  schedule?: string;
  channel?: string;
  channelId?: string | null;
  isActive?: boolean;
  maxOccurrences?: number | null;
  endDate?: Date | null;
}

// ============================================================================
// Basic Task CRUD (existing)
// ============================================================================

export async function createTask(
  workspaceId: string,
  userId: string,
  title: string,
  description?: string,
  options?: { pageId?: string; source?: string; status?: TaskStatus; parentTaskId?: string },
): Promise<Task> {
  return prisma.task.create({
    data: {
      title,
      description,
      status: options?.status ?? "Backlog",
      workspaceId,
      userId,
      ...(options?.pageId && { pageId: options.pageId }),
      ...(options?.source && { source: options.source }),
      ...(options?.parentTaskId && { parentTaskId: options.parentTaskId }),
    },
  });
}

export async function getTaskById(id: string): Promise<Task | null> {
  return prisma.task.findUnique({ where: { id } });
}

export type TaskWithRelations = Task & {
  subtasks: Pick<Task, "id" | "status">[];
  parentTask: Pick<Task, "id" | "title"> | null;
};

export type TaskFull = Task & {
  subtasks: Task[];
  parentTask: Pick<Task, "id" | "title"> | null;
};

export async function getTaskFull(
  id: string,
  workspaceId: string,
): Promise<TaskFull | null> {
  return prisma.task.findFirst({
    where: { id, workspaceId },
    include: {
      subtasks: { orderBy: { createdAt: "asc" } },
      parentTask: { select: { id: true, title: true } },
    },
  }) as Promise<TaskFull | null>;
}

export async function getTasks(
  workspaceId: string,
  status?: TaskStatus,
): Promise<TaskWithRelations[]> {
  return prisma.task.findMany({
    where: { workspaceId, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
    include: {
      subtasks: { select: { id: true, status: true } },
      parentTask: { select: { id: true, title: true } },
    },
  }) as Promise<TaskWithRelations[]>;
}

export async function searchTasks(
  workspaceId: string,
  search: string,
  limit = 10,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      workspaceId,
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function updateTask(
  id: string,
  data: { status?: TaskStatus; title?: string; description?: string },
): Promise<Task> {
  return prisma.task.update({ where: { id }, data });
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { status } });
}

/**
 * Central lifecycle handler for task status changes.
 * - Cancels any queued/executing job when moving away from InProgress
 * - Cancels scheduled jobs when deactivating
 */
export async function changeTaskStatus(
  taskId: string,
  status: TaskStatus,
  workspaceId: string,
  userId: string,
): Promise<Task> {
  if (status === "Backlog") {
    await cancelTaskJob(taskId);
  }

  // If moving a recurring/scheduled task to Completed or Blocked, deactivate scheduling
  if (status === "Completed" || status === "Blocked") {
    const task = await getTaskById(taskId);
    if (task?.nextRunAt || task?.schedule) {
      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: { isActive: false, nextRunAt: null },
      });
    }
  }

  const task = await updateTaskStatus(taskId, status);
  return task;
}

export async function updateTaskConversationIds(
  id: string,
  conversationIds: string[],
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { conversationIds } });
}

export async function markTaskInProcess(
  id: string,
  jobId?: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { status: "InProgress", ...(jobId && { jobId }) },
  });
}

export async function markTaskCompleted(
  id: string,
  result: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { status: "Completed", result },
  });
}

export async function markTaskFailed(id: string, error: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id } });
  const existingDescription = task?.description ?? "";
  const errorEntry = `\n\n[Error] ${new Date().toISOString()}: ${error}`;
  return prisma.task.update({
    where: { id },
    data: {
      status: "Blocked",
      error,
      description: existingDescription + errorEntry,
    },
  });
}

export async function deleteTask(
  id: string,
  workspaceId: string,
): Promise<Task> {
  const task = await prisma.task.findFirst({ where: { id, workspaceId } });
  if (!task) throw new Error(`Task ${id} not found`);

  // Cancel any scheduled/queued jobs
  if (task.nextRunAt || task.schedule) {
    await removeScheduledTask(id);
  }
  await cancelTaskJob(id);

  return prisma.task.delete({ where: { id } });
}

// ============================================================================
// Scheduled Task Functions (absorbed from reminder.server.ts)
// ============================================================================

/**
 * Create a scheduled task (replaces addReminder).
 * Schedule is stored as-is (in user's local timezone).
 * nextRunAt is computed and stored in UTC.
 */
export async function createScheduledTask(
  workspaceId: string,
  userId: string,
  data: ScheduledTaskData,
): Promise<Task> {
  // Get user's timezone
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { UserWorkspace: { include: { user: true }, take: 1 } },
  });
  const user = workspace?.UserWorkspace[0]?.user;
  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";

  // Determine the "after" time for computing next run
  let afterTime = new Date();
  if (data.startDate) {
    const startInUserTz = DateTime.fromJSDate(data.startDate)
      .setZone(timezone)
      .startOf("day");
    afterTime = startInUserTz.toJSDate();
  }

  // Compute nextRunAt
  let nextRunAt: Date | null = data.nextRunAt ?? null;
  if (!nextRunAt && data.schedule) {
    nextRunAt = computeNextRun(data.schedule, timezone, afterTime);
  }

  const status: TaskStatus = "Backlog";

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      status,
      workspaceId,
      userId,
      schedule: data.schedule ?? null,
      nextRunAt,
      channel: data.channel ?? null,
      channelId: data.channelId ?? null,
      startDate: data.startDate ?? null,
      maxOccurrences: data.maxOccurrences ?? null,
      occurrenceCount: 0,
      endDate: data.endDate ?? null,
      parentTaskId: data.parentTaskId ?? null,
      isActive: true,
      metadata: data.metadata ?? undefined,
    },
  });

  // Enqueue the scheduled job
  if (task.isActive && nextRunAt) {
    await enqueueScheduledTask(
      {
        taskId: task.id,
        workspaceId,
        userId,
        channel: task.channel ?? "email",
      },
      nextRunAt,
    );
  }

  logger.info(
    `Created scheduled task ${task.id} for workspace ${workspaceId}, next run: ${nextRunAt}`,
  );
  return task;
}

/**
 * Update a scheduled task's scheduling fields.
 */
export async function updateScheduledTask(
  taskId: string,
  workspaceId: string,
  data: ScheduledTaskUpdateData,
): Promise<Task> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    include: {
      workspace: {
        include: { UserWorkspace: { include: { user: true }, take: 1 } },
      },
    },
  });

  if (!existing) {
    throw new Error("Task not found or access denied");
  }

  const user = existing.workspace?.UserWorkspace[0]?.user;
  const userMeta = user?.metadata as Record<string, unknown> | null;
  const timezone = (userMeta?.timezone as string) ?? "UTC";

  // Use new schedule or keep existing
  const schedule = data.schedule ?? existing.schedule;

  // Compute new nextRunAt if schedule changed
  const nextRunAt = data.schedule
    ? computeNextRun(schedule!, timezone)
    : existing.nextRunAt;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.schedule !== undefined && { schedule, nextRunAt }),
      ...(data.channel !== undefined && { channel: data.channel }),
      ...(data.channelId !== undefined && { channelId: data.channelId }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.maxOccurrences !== undefined && {
        maxOccurrences: data.maxOccurrences,
      }),
      ...(data.endDate !== undefined && { endDate: data.endDate }),
    },
  });

  // Reschedule job
  await removeScheduledTask(taskId);
  if (task.isActive && task.nextRunAt) {
    await enqueueScheduledTask(
      {
        taskId: task.id,
        workspaceId,
        userId: existing.userId,
        channel: task.channel ?? "email",
      },
      task.nextRunAt,
    );
  }

  logger.info(`Updated scheduled task ${task.id} for workspace ${workspaceId}`);
  return task;
}

/**
 * Schedule next occurrence for a recurring task.
 */
export async function scheduleNextTaskOccurrence(
  taskId: string,
): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      workspace: {
        include: { UserWorkspace: { include: { user: true }, take: 1 } },
      },
    },
  });

  if (!task || !task.isActive || !task.schedule) {
    return false;
  }

  const user = task.workspace?.UserWorkspace[0]?.user;
  const userMeta = user?.metadata as Record<string, unknown> | null;
  const timezone = (userMeta?.timezone as string) ?? "UTC";

  const nextRunAt = computeNextRun(task.schedule, timezone);

  if (!nextRunAt) {
    logger.info(`No more occurrences for task ${taskId}`);
    await deactivateScheduledTask(taskId);
    return false;
  }

  // Check if next run is past endDate
  if (task.endDate && nextRunAt > task.endDate) {
    logger.info(`Task ${taskId} past endDate, deactivating`);
    await deactivateScheduledTask(taskId);
    return false;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { nextRunAt },
  });

  await enqueueScheduledTask(
    {
      taskId,
      workspaceId: task.workspaceId,
      userId: task.userId,
      channel: task.channel ?? "email",
    },
    nextRunAt,
  );

  logger.info(`Scheduled next occurrence for task ${taskId} at ${nextRunAt}`);
  return true;
}

/**
 * Increment occurrence count and check for auto-deactivation.
 */
export async function incrementTaskOccurrenceCount(
  taskId: string,
): Promise<{ task: Task; shouldDeactivate: boolean }> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      occurrenceCount: { increment: 1 },
      lastRunAt: new Date(),
    },
  });

  const shouldDeactivate = checkShouldDeactivate(task);

  if (shouldDeactivate) {
    await deactivateScheduledTask(taskId);
    logger.info(
      `Auto-deactivated task ${taskId} (occurrences: ${task.occurrenceCount}/${task.maxOccurrences})`,
    );
  }

  return { task, shouldDeactivate };
}

/**
 * Increment unresponded count for a scheduled task.
 */
export async function incrementTaskUnrespondedCount(
  taskId: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      unrespondedCount: { increment: 1 },
      lastSentAt: new Date(),
    },
  });
}

/**
 * Deactivate a scheduled task.
 */
export async function deactivateScheduledTask(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { isActive: false, nextRunAt: null },
  });

  await removeScheduledTask(taskId);
  logger.info(`Deactivated scheduled task ${taskId}`);
}

/**
 * Confirm a scheduled task as active — user wants to keep it.
 */
export async function confirmTaskActive(
  taskId: string,
  workspaceId: string,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId, workspaceId },
    data: { confirmedActive: true, unrespondedCount: 0 },
  });
  logger.info(`Confirmed task ${taskId} as active`);
}

/**
 * Reschedule a task to fire at a specific time (for follow-ups).
 */
export async function rescheduleTaskAt(
  taskId: string,
  workspaceId: string,
  nextRunAt: Date,
): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
  });

  if (!existing) {
    throw new Error("Task not found or access denied");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { nextRunAt, isActive: true },
  });

  await removeScheduledTask(taskId);
  await enqueueScheduledTask(
    {
      taskId,
      workspaceId,
      userId: existing.userId,
      channel: existing.channel ?? "email",
    },
    nextRunAt,
  );

  logger.info(
    `Rescheduled task ${taskId} for workspace ${workspaceId} at ${nextRunAt}`,
  );
}

/**
 * Get all active scheduled tasks for a workspace.
 */
export async function getScheduledTasksForWorkspace(
  workspaceId: string,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      workspaceId,
      isActive: true,
      nextRunAt: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all active scheduled tasks (for startup recovery).
 */
export async function getActiveScheduledTasks(): Promise<Task[]> {
  return prisma.task.findMany({
    where: { isActive: true, nextRunAt: { not: null } },
  });
}

/**
 * Recalculate all scheduled task nextRunAt when user's timezone changes.
 */
export async function recalculateTasksForTimezone(
  workspaceId: string,
  _oldTimezone: string,
  newTimezone: string,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  try {
    const tasks = await prisma.task.findMany({
      where: { workspaceId, isActive: true, schedule: { not: null } },
    });

    logger.info(
      `Recalculating ${tasks.length} scheduled tasks for timezone change to ${newTimezone}`,
    );

    for (const task of tasks) {
      try {
        if (!task.schedule) continue;

        const now = new Date();
        const nextRunAt = computeNextRun(task.schedule, newTimezone, now);

        // For one-time tasks, check if already passed
        const isOneTime = task.maxOccurrences === 1;

        if (isOneTime && (!nextRunAt || nextRunAt < now)) {
          await prisma.task.update({
            where: { id: task.id },
            data: { isActive: false, nextRunAt: null },
          });
          await removeScheduledTask(task.id);
          updated++;
          continue;
        }

        await prisma.task.update({
          where: { id: task.id },
          data: { nextRunAt },
        });

        await removeScheduledTask(task.id);
        if (nextRunAt) {
          await enqueueScheduledTask(
            {
              taskId: task.id,
              workspaceId,
              userId: task.userId,
              channel: task.channel ?? "email",
            },
            nextRunAt,
          );
        }

        updated++;
      } catch (error) {
        logger.error(`Failed to recalculate task ${task.id}`, { error });
        failed++;
      }
    }

    logger.info(
      `Timezone recalculation complete: ${updated} updated, ${failed} failed`,
    );
    return { updated, failed };
  } catch (error) {
    logger.error("Failed to recalculate tasks for timezone change", { error });
    return { updated, failed };
  }
}
