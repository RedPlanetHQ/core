/**
 * BullMQ Worker Logger
 *
 * Comprehensive logging utility for tracking worker status, queue metrics,
 * and job lifecycle events
 */

import { type Worker, type Queue } from "bullmq";
import { logger } from "~/services/logger.service";

interface WorkerMetrics {
  name: string;
  concurrency: number;
  activeJobs: number;
  waitingJobs: number;
  delayedJobs: number;
  failedJobs: number;
  completedJobs: number;
}

/**
 * Setup comprehensive logging for a worker
 */
export function setupWorkerLogging(
  worker: Worker,
  queue: Queue,
  workerName: string,
): void {
  // Job picked up and started processing
  worker.on("active", async (job) => {
    const counts = await getQueueCounts(queue);
    logger.log(
      `[${workerName}] 🔄 Job started: ${job.id} | Queue: ${counts.waiting} waiting, ${counts.active} active, ${counts.delayed} delayed`,
    );
  });

  // Job completed successfully
  worker.on("completed", async (job, result) => {
    const counts = await getQueueCounts(queue);
    const duration = job.finishedOn ? job.finishedOn - job.processedOn! : 0;
    logger.log(
      `[${workerName}] ✅ Job completed: ${job.id} (${duration}ms) | Queue: ${counts.waiting} waiting, ${counts.active} active`,
    );
  });

  // Job failed
  worker.on("failed", async (job, error) => {
    const counts = await getQueueCounts(queue);
    const attempt = job?.attemptsMade || 0;
    const maxAttempts = job?.opts?.attempts || 3;
    logger.error(
      `[${workerName}] ❌ Job failed: ${job?.id} (attempt ${attempt}/${maxAttempts}) | Error: ${error.message} | Queue: ${counts.waiting} waiting, ${counts.failed} failed`,
    );
  });

  // Job progress update (if job reports progress)
  worker.on("progress", async (job, progress) => {
    logger.log(`[${workerName}] 📊 Job progress: ${job.id} - ${progress}%`);
  });

  // Worker stalled (job took too long)
  worker.on("stalled", async (jobId) => {
    logger.warn(`[${workerName}] ⚠️  Job stalled: ${jobId}`);
  });

  // Worker error
  worker.on("error", (error) => {
    logger.error(`[${workerName}] 🔥 Worker error: ${error.message}`);
  });

  // Worker closed
  worker.on("closed", () => {
    logger.log(`[${workerName}] 🛑 Worker closed`);
  });
}

/**
 * Get queue counts for logging
 */
async function getQueueCounts(queue: Queue): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}> {
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
    );
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      failed: counts.failed || 0,
      completed: counts.completed || 0,
    };
  } catch (error) {
    return { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
  }
}

/**
 * Get metrics for all workers
 */
export async function getAllWorkerMetrics(
  workers: Array<{ worker: Worker; queue: Queue; name: string }>,
): Promise<WorkerMetrics[]> {
  const metrics = await Promise.all(
    workers.map(async ({ worker, queue, name }) => {
      const counts = await getQueueCounts(queue);
      return {
        name,
        concurrency: worker.opts.concurrency || 1,
        activeJobs: counts.active,
        waitingJobs: counts.waiting,
        delayedJobs: counts.delayed,
        failedJobs: counts.failed,
        completedJobs: counts.completed,
      };
    }),
  );

  return metrics;
}

/**
 * Log worker metrics summary
 */
export function logWorkerMetrics(metrics: WorkerMetrics[]): void {
  logger.log("\n📊 BullMQ Worker Metrics:");
  logger.log("─".repeat(80));

  for (const metric of metrics) {
    logger.log(
      `[${metric.name.padEnd(25)}] Concurrency: ${metric.concurrency} | ` +
        `Active: ${metric.activeJobs} | Waiting: ${metric.waitingJobs} | ` +
        `Delayed: ${metric.delayedJobs} | Failed: ${metric.failedJobs} | ` +
        `Completed: ${metric.completedJobs}`,
    );
  }

  const totals = metrics.reduce(
    (acc, m) => ({
      active: acc.active + m.activeJobs,
      waiting: acc.waiting + m.waitingJobs,
      delayed: acc.delayed + m.delayedJobs,
      failed: acc.failed + m.failedJobs,
      completed: acc.completed + m.completedJobs,
    }),
    { active: 0, waiting: 0, delayed: 0, failed: 0, completed: 0 },
  );

  logger.log("─".repeat(80));
  logger.log(
    `[TOTAL] Active: ${totals.active} | Waiting: ${totals.waiting} | ` +
      `Delayed: ${totals.delayed} | Failed: ${totals.failed} | ` +
      `Completed: ${totals.completed}`,
  );
  logger.log("─".repeat(80) + "\n");
}

/**
 * Start periodic metrics logging
 */
export function startPeriodicMetricsLogging(
  workers: Array<{ worker: Worker; queue: Queue; name: string }>,
  intervalMs: number = 60000, // Default: 1 minute
): NodeJS.Timeout {
  const logMetrics = async () => {
    const metrics = await getAllWorkerMetrics(workers);
    logWorkerMetrics(metrics);
  };

  // Log immediately on start
  logMetrics();

  // Then log periodically
  return setInterval(logMetrics, intervalMs);
}
