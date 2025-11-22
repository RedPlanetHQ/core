import { task } from "@trigger.dev/sdk";
import {
  processGraphResolution,
  type GraphResolutionPayload,
} from "~/jobs/ingest/graph-resolution.logic";

// Register the Trigger.dev task for graph resolution
export const graphResolutionTask = task({
  id: "graph-resolution",
  machine: "small-2x",
  retry: {
    maxAttempts: 3,
    maxTimeoutInMs: 10000,
    randomize: true,
    outOfMemory: { machine: "medium-1x" },
  },
  run: async (payload: GraphResolutionPayload) => {
    return await processGraphResolution(payload);
  },
});
