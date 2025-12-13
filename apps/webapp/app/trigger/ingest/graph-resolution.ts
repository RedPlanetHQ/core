import { queue, task } from "@trigger.dev/sdk";
import {
  processGraphResolution,
  type GraphResolutionPayload,
} from "~/jobs/ingest/graph-resolution.logic";
import { initializeProvider } from "../utils/provider";

const graphResolutionQueue = queue({
  name: "graph-resolution-queue",
  concurrencyLimit: 1,
});

// Register the Trigger.dev task for graph resolution
export const graphResolutionTask = task({
  id: "graph-resolution",
  machine: "medium-2x",
  queue: graphResolutionQueue,
  retry: {
    maxAttempts: 3,
    maxTimeoutInMs: 10000,
    randomize: true,
    outOfMemory: { machine: "medium-1x" },
  },
  run: async (payload: GraphResolutionPayload) => {
    await initializeProvider();
    return await processGraphResolution(payload);
  },
});
