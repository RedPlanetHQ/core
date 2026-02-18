import { queue, task } from "@trigger.dev/sdk";
import {
  processEpisodeIngestion,
  IngestBodyRequest,
  type IngestEpisodePayload,
} from "~/jobs/ingest/ingest-episode.logic";
import { labelAssignmentTask } from "../labels/label-assignment";
import { titleGenerationTask } from "../titles/title-generation";
import { personaGenerationTask } from "../spaces/persona-generation";
import { graphResolutionTask } from "./graph-resolution";
import { initializeProvider } from "../utils/provider";

const ingestionQueue = queue({
  name: "ingestion-queue",
  concurrencyLimit: 5,
});

// Export for backwards compatibility
export { IngestBodyRequest };

// Register the Trigger.dev task
export const ingestTask = task({
  id: "ingest-episode",
  queue: ingestionQueue,
  machine: "medium-2x",
  run: async (payload: IngestEpisodePayload) => {
    // Initialize ProviderFactory for Trigger.dev job context
    await initializeProvider();

    // Use common logic with Trigger-specific callbacks for follow-up jobs
    return await processEpisodeIngestion(
      payload,
      // Callback for label assignment
      async (params) => {
        await labelAssignmentTask.trigger(params, {
          queue: "label-assignment-queue",
          tags: [payload.queueId],
        });
      },
      // Callback for title generation
      async (params) => {
        await titleGenerationTask.trigger(params, {
          tags: [payload.queueId],
        });
      },
      // Callback for persona generation
      async (params) => {
        await personaGenerationTask.trigger(params, {
          queue: "persona-generation-queue",
          concurrencyKey: payload.userId,
          tags: [payload.userId, payload.queueId],
          idempotencyKey: payload.userId,
          idempotencyKeyTTL: "10m",
        });
      },
      // Callback for async graph resolution
      async (params) => {
        await graphResolutionTask.trigger(params, {
          queue: "graph-resolution-queue",
          concurrencyKey: payload.userId,
          tags: [payload.userId, payload.queueId],
        });
      },
    );
  },
});
