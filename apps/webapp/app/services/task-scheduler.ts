/**
 * Scheduled Task Scheduler
 *
 * Initialization and recovery logic for the scheduled task system.
 * Re-enqueues missed or orphaned scheduled tasks on startup.
 */

import { logger } from "./logger.service";
import { prisma } from "../db.server";
import { enqueueScheduledTask } from "~/lib/queue-adapter.server";

/**
 * Check if a scheduled task job exists and is pending/delayed. scheduled-task
 * is always a BullMQ job now, whatever QUEUE_PROVIDER says.
 */
async function hasScheduledJob(taskId: string): Promise<boolean> {
  try {
    const { scheduledTaskQueue } = await import("~/bullmq/queues");
    const delayed = await scheduledTaskQueue.getDelayed();
    const waiting = await scheduledTaskQueue.getWaiting();
    const jobs = [...delayed, ...waiting];

    return jobs.some((job) => job.data.taskId === taskId);
  } catch {
    return false;
  }
}

/**
 * Initialize scheduled task scheduler - recover missed jobs on startup
 */
export async function initializeScheduledTaskScheduler() {
  try {
    logger.info("Initializing scheduled task scheduler...");

    // Get all active scheduled tasks with a nextRunAt
    const tasks = await prisma.task.findMany({
      where: {
        isActive: true,
        nextRunAt: { not: null },
      },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        channel: true,
        nextRunAt: true,
      },
    });

    logger.info(`Found ${tasks.length} active scheduled tasks`);

    const now = new Date();
    let recovered = 0;

    for (const task of tasks) {
      if (!task.nextRunAt) continue;

      const hasJob = await hasScheduledJob(task.id);

      if (!hasJob) {
        const runAt = task.nextRunAt < now ? now : task.nextRunAt;
        if (task.nextRunAt < now) {
          logger.info(
            `Scheduled task ${task.id} missed (was ${task.nextRunAt.toISOString()}), triggering now`,
          );
        }

        await enqueueScheduledTask(
          {
            taskId: task.id,
            workspaceId: task.workspaceId,
            userId: task.userId,
            channel: task.channel ?? "email",
          },
          runAt,
        );
        recovered++;
      }
    }

    logger.info(
      `Scheduled task scheduler initialized — recovered ${recovered} jobs`,
    );
  } catch (error) {
    logger.error("Failed to initialize scheduled task scheduler", { error });
    throw error;
  }
}
