/**
 * Job Manager Service
 *
 * Unified interface for managing background jobs across both
 * Trigger.dev and BullMQ queue providers.
 */

import { env } from "~/env.server";

type QueueProvider = "trigger" | "bullmq";

interface JobInfo {
  id: string;
  isCompleted: boolean;
  status?: string;
}

/**
 * Find running jobs by tags/identifiers
 */
export async function findRunningJobs(params: {
  tags: string[];
  taskIdentifier?: string;
}): Promise<JobInfo[]> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { runs } = await import("@trigger.dev/sdk");
    const runningTasks = await runs.list({
      tag: params.tags,
      taskIdentifier: params.taskIdentifier,
    });

    return runningTasks.data.map((task) => ({
      id: task.id,
      isCompleted: task.isCompleted,
      status: task.status,
    }));
  } else {
    // BullMQ
    const { getJobsByTags } = await import("~/bullmq/utils/job-finder");
    const jobs = await getJobsByTags(params.tags, params.taskIdentifier);

    return jobs;
  }
}

/**
 * Cancel a running job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { runs } = await import("@trigger.dev/sdk");
    await runs.cancel(jobId);
  } else {
    // BullMQ
    const { cancelJobById } = await import("~/bullmq/utils/job-finder");
    await cancelJobById(jobId);
  }
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobInfo | null> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { runs } = await import("@trigger.dev/sdk");
    try {
      const run = await runs.retrieve(jobId);
      return {
        id: run.id,
        isCompleted: run.isCompleted,
        status: run.status,
      };
    } catch {
      return null;
    }
  } else {
    // BullMQ
    const { getJobById } = await import("~/bullmq/utils/job-finder");
    return await getJobById(jobId);
  }
}
