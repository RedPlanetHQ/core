import { task, queue } from "@trigger.dev/sdk";
import { processEpisodePreprocessing } from "~/jobs/ingest/preprocess-episode.logic";
import { ingestTask } from "./ingest";
import { type IngestEpisodePayload } from "~/jobs/ingest/ingest-episode.logic";
import { initializeProvider } from "../utils/provider";
import { enqueueSessionCompaction } from "~/lib/queue-adapter.server";

const preprocessingQueue = queue({
  name: "preprocessing-queue",
  concurrencyLimit: 50,
});

// Register the Trigger.dev task for episode preprocessing
export const preprocessTask = task({
  id: "preprocess-episode",
  queue: preprocessingQueue,
  machine: "small-1x", // Preprocessing is less resource-intensive than graph operations
  run: async (payload: IngestEpisodePayload) => {
    await initializeProvider();
    // Use common logic with Trigger-specific callbacks
    return await processEpisodePreprocessing(
      payload,
      // Callback to enqueue individual chunk ingestion jobs
      async (params) => {
        await ingestTask.trigger(params, {
          queue: "ingestion-queue",
          concurrencyKey: params.userId,
          tags: [params.userId, params.queueId],
        });
      },
      // Callback to enqueue session compaction for conversations
      async (compactionPayload) => {
        await enqueueSessionCompaction(compactionPayload);
      },
    );
  },
});
