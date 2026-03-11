import { queue, task } from "@trigger.dev/sdk";
import {
  processAspectResolution,
  type AspectResolutionPayload,
} from "~/jobs/ingest/aspect-resolution.logic";
import { initializeProvider } from "../utils/provider";

const aspectResolutionQueue = queue({
  name: "aspect-resolution-queue",
  concurrencyLimit: 1,
});

// Register the Trigger.dev task for voice aspect resolution
export const aspectResolutionTask = task({
  id: "aspect-resolution",
  machine: "medium-2x",
  queue: aspectResolutionQueue,
  retry: {
    maxAttempts: 3,
    maxTimeoutInMs: 10000,
    randomize: true,
    outOfMemory: { machine: "medium-1x" },
  },
  run: async (payload: AspectResolutionPayload) => {
    await initializeProvider();
    return await processAspectResolution(payload);
  },
});
