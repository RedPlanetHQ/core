/**
 * BullMQ Job Finder Utilities
 *
 * Helper functions to find, retrieve, and cancel BullMQ jobs
 */

interface JobInfo {
  id: string;
  isCompleted: boolean;
  status?: string;
}

/**
 * Get all active queues
 */
async function getAllQueues() {
  const {
    ingestQueue,
    preprocessQueue,
    labelAssignmentQueue,
    titleGenerationQueue,
    personaGenerationQueue,
    conversationTitleQueue,
    sessionCompactionQueue,
  } = await import("../queues");

  return [
    ingestQueue,
    preprocessQueue,
    labelAssignmentQueue,
    titleGenerationQueue,
    personaGenerationQueue,
    conversationTitleQueue,
    sessionCompactionQueue,
  ];
}

/**
 * Find jobs by tags (metadata stored in job data)
 * Since BullMQ doesn't have native tag support like Trigger.dev,
 * we search through jobs and check if their data contains the required identifiers
 */
export async function getJobsByTags(
  tags: string[],
  taskIdentifier?: string,
): Promise<JobInfo[]> {
  const queues = await getAllQueues();
  const matchingJobs: JobInfo[] = [];

  for (const queue of queues) {
    // Skip if taskIdentifier is specified and doesn't match queue name
    if (taskIdentifier && !queue.name.includes(taskIdentifier)) {
      continue;
    }

    // Get all active and waiting jobs
    const [active, waiting, delayed] = await Promise.all([
      queue.getActive(),
      queue.getWaiting(),
      queue.getDelayed(),
    ]);

    const allJobs = [...active, ...waiting, ...delayed];

    for (const job of allJobs) {
      // Check if job data contains all required tags
      const jobData = job.data as any;
      const matchesTags = tags.every(
        (tag) =>
          job.id?.includes(tag) ||
          jobData.userId === tag ||
          jobData.workspaceId === tag ||
          jobData.queueId === tag,
      );

      if (matchesTags) {
        const state = await job.getState();
        matchingJobs.push({
          id: job.id!,
          isCompleted: state === "completed" || state === "failed",
          status: state,
        });
      }
    }
  }

  return matchingJobs;
}

/**
 * Get a specific job by ID across all queues
 */
export async function getJobById(jobId: string): Promise<JobInfo | null> {
  const queues = await getAllQueues();

  for (const queue of queues) {
    try {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        return {
          id: job.id!,
          isCompleted: state === "completed" || state === "failed",
          status: state,
        };
      }
    } catch {
      // Job not in this queue, continue
      continue;
    }
  }

  return null;
}

/**
 * Cancel a job by ID
 */
export async function cancelJobById(jobId: string): Promise<void> {
  const queues = await getAllQueues();

  for (const queue of queues) {
    try {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        // Only remove if not already completed
        if (state !== "completed" && state !== "failed") {
          await job.remove();
        }
        return;
      }
    } catch {
      // Job not in this queue, continue
      continue;
    }
  }
}
