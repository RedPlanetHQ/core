import { queue, task } from "@trigger.dev/sdk";
import {
  processBackgroundTask,
  type BackgroundTaskPayload,
} from "~/jobs/background-task/background-task.logic";

const backgroundTaskQueueDef = queue({
  name: "background-task-queue",
  concurrencyLimit: 10,
});

/**
 * Background task runner for Trigger.dev
 *
 * Executes long-running tasks with timeout support.
 * Max duration: 1 hour
 */
export const backgroundTaskRunner = task({
  id: "background-task-runner",
  queue: backgroundTaskQueueDef,
  maxDuration: 3600, // 1 hour max
  run: async (payload: BackgroundTaskPayload) => {
    return await processBackgroundTask(payload);
  },
});
