import { queue, task } from "@trigger.dev/sdk";
import {
  processScratchpadScan,
  type ScratchpadScanPayload,
} from "~/jobs/scratchpad/scratchpad-scan.logic";
import { initializeProvider } from "../utils/provider";

const scratchpadQueue = queue({
  name: "scratchpad-scan-queue",
  concurrencyLimit: 10,
});

export const scratchpadScanTask = task({
  id: "scratchpad-scan",
  machine: "medium-2x",
  maxDuration: 300,
  queue: scratchpadQueue,
  run: async (payload: ScratchpadScanPayload) => {
    await initializeProvider();
    return await processScratchpadScan(payload);
  },
});
