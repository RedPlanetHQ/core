import { queue, task } from "@trigger.dev/sdk";
import {
  processDocumentIngestion,
  type IngestDocumentPayload,
} from "~/jobs/ingest/ingest-document.logic";
import { ingestTask } from "./ingest";

const documentIngestionQueue = queue({
  name: "document-ingestion-queue",
  concurrencyLimit: 1,
});

// Register the Document Ingestion Trigger.dev task
export const ingestDocumentTask = task({
  id: "ingest-document",
  queue: documentIngestionQueue,
  machine: "medium-2x",
  run: async (payload: IngestDocumentPayload) => {
    // Use common logic with Trigger-specific callback for episode ingestion
    return await processDocumentIngestion(
      payload,
      // Callback for enqueueing episode ingestion for each chunk
      async (episodePayload) => {
        const episodeHandler = await ingestTask.trigger(episodePayload, {
          queue: "ingestion-queue",
          concurrencyKey: episodePayload.userId,
          tags: [episodePayload.userId, episodePayload.queueId],
        });
        return { id: episodeHandler.id };
      },
    );
  },
});
