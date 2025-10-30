import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import {
  processSpaceSummary,
  type SpaceSummaryPayload,
} from "~/jobs/spaces/space-summary.logic";

export type { SpaceSummaryPayload };

export const spaceSummaryQueue = queue({
  name: "space-summary-queue",
  concurrencyLimit: 1,
});

export const spaceSummaryTask = task({
  id: "space-summary",
  queue: spaceSummaryQueue,
  run: async (payload: SpaceSummaryPayload) => {
    logger.info(`[Trigger.dev] Starting space summary task`, {
      userId: payload.userId,
      spaceId: payload.spaceId,
      triggerSource: payload.triggerSource,
    });

    // Use common business logic
    return await processSpaceSummary(payload);
  },
});

// Helper function to trigger the task
export async function triggerSpaceSummary(payload: SpaceSummaryPayload) {
  return await spaceSummaryTask.trigger(payload, {
    queue: "space-summary-queue",
    concurrencyKey: payload.userId,
    tags: [payload.userId, payload.spaceId],
  });
}
