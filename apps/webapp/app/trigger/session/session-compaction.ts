import { queue, task } from "@trigger.dev/sdk/v3";
import {
  processSessionCompaction,
  type SessionCompactionPayload,
} from "~/jobs/session/session-compaction.logic";

export const sessionCompactionQueue = queue({
  name: "session-compaction-queue",
  concurrencyLimit: 1,
});

export const sessionCompactionTask = task({
  id: "session-compaction",
  queue: sessionCompactionQueue,
  run: async (payload: SessionCompactionPayload) => {
    return await processSessionCompaction(payload);
  },
});

/**
 * Trigger compaction for a session
 */
export async function triggerSessionCompaction(
  payload: SessionCompactionPayload,
) {
  return await sessionCompactionTask.trigger(payload);
}
