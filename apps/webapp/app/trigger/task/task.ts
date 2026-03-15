import { queue, task } from "@trigger.dev/sdk";
import { processTask, type TaskPayload } from "~/jobs/task/task.logic";

const taskQueueDef = queue({
  name: "task-queue",
  concurrencyLimit: 3,
});

export const taskRunner = task({
  id: "task-runner",
  queue: taskQueueDef,
  maxDuration: 3600,
  run: async (payload: TaskPayload) => {
    return await processTask(payload);
  },
});
