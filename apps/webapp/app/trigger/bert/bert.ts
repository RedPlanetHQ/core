import { queue, task } from "@trigger.dev/sdk/v3";
import { python } from "@trigger.dev/python";
import {
  processTopicAnalysis,
  type TopicAnalysisPayload,
} from "~/jobs/bert/topic-analysis.logic";
import { initializeProvider } from "../utils/provider";

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

const bertQueue = queue({
  name: "bert-topic-queue",
  concurrencyLimit: 1,
});

/**
 * Trigger.dev task for BERT topic analysis
 *
 * This is a thin wrapper around the common logic in jobs/bert/topic-analysis.logic.ts
 */
export const bertTopicAnalysisTask = task({
  id: "bert-topic-analysis",
  machine: "large-2x",
  queue: bertQueue,
  maxDuration: 36000,
  run: async (payload: TopicAnalysisPayload) => {
    await initializeProvider();
    return await processTopicAnalysis(
      payload,
      // Python runner for Trigger.dev
      runBertWithTriggerPython,
    );
  },
});
