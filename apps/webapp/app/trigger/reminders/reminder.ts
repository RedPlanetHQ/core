import { queue, task } from "@trigger.dev/sdk";
import {
  processReminderJob,
  processFollowUpJob,
  type ReminderJobData,
  type FollowUpJobData,
} from "~/jobs/reminder/reminder.logic";
import {
  scheduleNextOccurrence,
  deactivateReminder,
} from "~/services/reminder.server";
import { initializeProvider } from "../utils/provider";

const reminderQueue = queue({
  name: "reminder-queue",
  concurrencyLimit: 10,
});

const followUpQueueDef = queue({
  name: "followup-queue",
  concurrencyLimit: 5,
});

/**
 * Reminder task for Trigger.dev
 */
export const reminderTask = task({
  id: "process-reminder",
  maxDuration: 600,
  queue: reminderQueue,
  run: async (payload: ReminderJobData) => {
    await initializeProvider();
    return await processReminderJob(
      payload,
      scheduleNextOccurrence,
      deactivateReminder,
    );
  },
});

/**
 * Follow-up task for Trigger.dev
 */
export const followUpTask = task({
  id: "process-followup",
  queue: followUpQueueDef,
  run: async (payload: FollowUpJobData) => {
    await initializeProvider();
    return await processFollowUpJob(payload);
  },
});
