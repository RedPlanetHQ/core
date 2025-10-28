import { task } from "@trigger.dev/sdk/v3";
import { python } from "@trigger.dev/python";
import {
  processTopicAnalysis,
  type TopicAnalysisPayload,
} from "~/jobs/bert/topic-analysis.logic";
import { spaceSummaryTask } from "~/trigger/spaces/space-summary";

/**
 * Python runner for Trigger.dev using python.runScript
 */
async function runBertWithTriggerPython(
  userId: string,
  minTopicSize: number,
  nrTopics?: number,
): Promise<string> {
  const args = [userId, "--json", "--min-topic-size", String(minTopicSize)];

  if (nrTopics) {
    args.push("--nr-topics", String(nrTopics));
  }

  console.log(`[BERT Topic Analysis] Running with Trigger.dev Python: args=${args.join(" ")}`);

  const result = await python.runScript("./apps/webapp/app/bert/main.py", args);
  return result.stdout;
}

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
    return await processTopicAnalysis(
      payload,
      // Callback to enqueue space summary
      async (params) => {
        await spaceSummaryTask.trigger(params);
      },
      // Python runner for Trigger.dev
      runBertWithTriggerPython,
    );
  },
});
