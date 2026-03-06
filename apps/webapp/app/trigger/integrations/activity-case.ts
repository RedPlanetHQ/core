import { queue, task } from "@trigger.dev/sdk";
import {
  processActivityCase,
  type ActivityCasePayload,
} from "~/jobs/integrations/activity-case.logic";
import { initializeProvider } from "../utils/provider";

const activityCaseQueueDef = queue({
  name: "activity-case-queue",
  concurrencyLimit: 5,
});

export const activityCaseTask = task({
  id: "activity-case",
  queue: activityCaseQueueDef,
  run: async (payload: ActivityCasePayload) => {
    await initializeProvider();
    return await processActivityCase(payload);
  },
});
