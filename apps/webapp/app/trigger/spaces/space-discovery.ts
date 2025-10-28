import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import {
  processSpaceDiscovery,
  type SpaceDiscoveryPayload,
} from "~/jobs/spaces/space-discovery.logic";

export type { SpaceDiscoveryPayload };

export const spaceDiscoveryQueue = queue({
  name: "space-discovery-queue",
  concurrencyLimit: 1, // One discovery job at a time globally
});

export const spaceDiscoveryTask = task({
  id: "space-discovery",
  queue: spaceDiscoveryQueue,
  run: async (payload: SpaceDiscoveryPayload) => {
    logger.info(`[Trigger.dev] Starting space discovery task`, {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      minEpisodeCount: payload.minEpisodeCount,
      maxEntities: payload.maxEntities,
      autoCreateThreshold: payload.autoCreateThreshold,
    });

    // Use common business logic
    return await processSpaceDiscovery(payload);
  },
});

// Helper function to trigger the task
export async function triggerSpaceDiscovery(payload: SpaceDiscoveryPayload) {
  return await spaceDiscoveryTask.trigger(payload, {
    queue: "space-discovery-queue",
    concurrencyKey: payload.userId, // One discovery per user at a time
    tags: [payload.userId, payload.workspaceId, "space-discovery"],
  });
}
