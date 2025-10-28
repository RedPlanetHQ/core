import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import {
  processSpaceAssignment,
  type SpaceAssignmentPayload,
} from "~/jobs/spaces/space-assignment.logic";
import { triggerSpaceSummary } from "./space-summary";

export type { SpaceAssignmentPayload };

const spaceAssignmentQueue = queue({
  name: "space-assignment-queue",
  concurrencyLimit: 1,
});

export const spaceAssignmentTask = task({
  id: "space-assignment",
  queue: spaceAssignmentQueue,
  maxDuration: 1800, // 15 minutes timeout
  run: async (payload: SpaceAssignmentPayload) => {
    logger.info(`[Trigger.dev] Starting space assignment task`, {
      userId: payload.userId,
      mode: payload.mode,
    });

    // Use common business logic with callback for triggering space summaries
    return await processSpaceAssignment(
      payload,
      // Callback to enqueue space summary
      async (summaryPayload) => {
        return await triggerSpaceSummary(summaryPayload);
      },
    );
  },
});

// Helper function to trigger the task
export async function triggerSpaceAssignment(payload: SpaceAssignmentPayload) {
  return await spaceAssignmentTask.trigger(payload, {
    queue: "space-assignment-queue",
    concurrencyKey: payload.userId,
    tags: [payload.userId],
  });
}
