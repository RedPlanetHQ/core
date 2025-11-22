import { queue, task } from "@trigger.dev/sdk";
import {
  processEpisodeIngestion,
  IngestBodyRequest,
  type IngestEpisodePayload,
} from "~/jobs/ingest/ingest-episode.logic";
import { triggerSessionCompaction } from "../session/session-compaction";
import { labelAssignmentTask } from "../labels/label-assignment";
import { titleGenerationTask } from "../titles/title-generation";
import { bertTopicAnalysisTask } from "../bert/bert";
import { personaGenerationTask } from "../spaces/persona-generation";
import { graphResolutionTask } from "./graph-resolution";

const ingestionQueue = queue({
  name: "ingestion-queue",
  concurrencyLimit: 1,
});

// Export for backwards compatibility
export { IngestBodyRequest };

// Register the Trigger.dev task
export const ingestTask = task({
  id: "ingest-episode",
  queue: ingestionQueue,
  machine: "medium-2x",
  run: async (payload: IngestEpisodePayload) => {
    // Use common logic with Trigger-specific callbacks for follow-up jobs
    return await processEpisodeIngestion(
      payload,
      // Callback for label assignment
      async (params) => {
        await labelAssignmentTask.trigger(params);
      },
      // Callback for title generation
      async (params) => {
        await titleGenerationTask.trigger(params);
      },
      // Callback for session compaction
      async (params) => {
        await triggerSessionCompaction(params);
      },
      // Callback for BERT topic analysis
      async (params) => {
        await bertTopicAnalysisTask.trigger(params);
      },
      // Callback for persona generation
      async (params) => {
        await personaGenerationTask.trigger(params);
      },
      // Callback for async graph resolution
      async (params) => {
        await graphResolutionTask.trigger(params);
      },
    );
  },
});
