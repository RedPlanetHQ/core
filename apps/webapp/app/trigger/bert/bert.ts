import { task } from "@trigger.dev/sdk/v3";
import { python } from "@trigger.dev/python";
import {
  processTopicAnalysis,
  type TopicAnalysisPayload,
} from "~/jobs/bert/topic-analysis.logic";

/**
 * Python runner for Trigger.dev using python.runScript
 */
async function runBertWithTriggerPython(
  userId: string,
  _minTopicSize: number,
  _nrTopics?: number,
): Promise<string> {
  const args = [userId, "--json"];

  console.log(
    `[BERT Topic Analysis] Running with Trigger.dev Python: args=${args.join(" ")}`,
  );

  const result = await python.runScript("./python/main.py", args);
  return result.stdout;
}

/**
 * Trigger.dev task for BERT topic analysis
 *
 * This is a thin wrapper around the common logic in jobs/bert/topic-analysis.logic.ts
 */
export const bertTopicAnalysisTask = task({
  id: "bert-topic-analysis",
  run: async (payload: TopicAnalysisPayload) => {
    return await processTopicAnalysis(
      payload,
      // Python runner for Trigger.dev
      runBertWithTriggerPython,
    );
  },
});
