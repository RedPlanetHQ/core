import { queue, task } from "@trigger.dev/sdk";
import {
  processMemoryIngestCase,
  type MemoryIngestPayload,
} from "~/jobs/memory-ingest/memory-ingest-case.logic";
import { initializeProvider } from "../utils/provider";

const memoryIngestCaseQueueDef = queue({
  name: "memory-ingest-case-queue",
  concurrencyLimit: 5,
});

export const memoryIngestCaseTask = task({
  id: "memory-ingest-case",
  queue: memoryIngestCaseQueueDef,
  run: async (payload: MemoryIngestPayload) => {
    await initializeProvider();
    return await processMemoryIngestCase(payload);
  },
});
