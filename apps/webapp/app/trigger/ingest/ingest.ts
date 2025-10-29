import { queue, task } from "@trigger.dev/sdk";
import {
  processEpisodeIngestion,
  IngestBodyRequest,
  type IngestEpisodePayload,
} from "~/jobs/ingest/ingest-episode.logic";
import { triggerSpaceAssignment } from "../spaces/space-assignment";
import { triggerSessionCompaction } from "../session/session-compaction";
import { bertTopicAnalysisTask } from "../bert/topic-analysis";

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
      // Callback for space assignment
      async (params) => {
        await triggerSpaceAssignment(params);
      },
      // Callback for session compaction
      async (params) => {
        await triggerSessionCompaction(params);
      },
      // Callback for BERT topic analysis
      async (params) => {
        await bertTopicAnalysisTask.trigger(params, {
          queue: "bert-topic-analysis",
          concurrencyKey: params.userId,
          tags: [params.userId, "bert-analysis"],
        });
      },
    );
  },
});
