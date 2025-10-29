import { task } from "@trigger.dev/sdk/v3";
import {
  processTopicAnalysis,
  type TopicAnalysisPayload,
} from "~/jobs/bert/topic-analysis.logic";

/**
 * Trigger.dev task for BERT topic analysis
 *
 * This is a thin wrapper around the common logic in jobs/bert/topic-analysis.logic.ts
 */
export const bertTopicAnalysisTask = task({
  id: "bert-topic-analysis",
  queue: {
    name: "bert-topic-analysis",
    concurrencyLimit: 3, // Max 3 parallel analyses to avoid CPU overload
  },
  run: async (payload: TopicAnalysisPayload) => {
    return await processTopicAnalysis(payload);
  },
});
