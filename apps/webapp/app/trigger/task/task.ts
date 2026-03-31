import { queue, task } from "@trigger.dev/sdk";
import { processTask, type TaskPayload } from "~/jobs/task/task.logic";
import {
  processScheduledTask,
  type ScheduledTaskPayload,
} from "~/jobs/task/scheduled-task.logic";
import { initializeProvider } from "../utils/provider";

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

const scheduledTaskQueueDef = queue({
  name: "scheduled-task-queue",
  concurrencyLimit: 10,
});

export const scheduledTaskRunner = task({
  id: "process-scheduled-task",
  maxDuration: 600,
  machine: "large-1x",
  queue: scheduledTaskQueueDef,
  run: async (payload: ScheduledTaskPayload) => {
    await initializeProvider();
    return await processScheduledTask(payload);
  },
});
