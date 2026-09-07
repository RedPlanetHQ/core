/**
 * Always-on BullMQ workers
 *
 * Three jobs run on BullMQ in every deployment, regardless of
 * QUEUE_PROVIDER: run-agent-turn, scratchpad-scan and case.
 *
 * Why they're pinned here rather than following the provider: all three
 * write ConversationHistory rows, and `upsertConversationHistory` fires a
 * PUBLISH on the app's Redis so connected SSE clients pick the row up
 * without polling. A trigger.dev worker runs in a separate runtime against
 * its OWN Redis, so that publish reaches nobody — the conversation sits on
 * "Working…" until the user refreshes. Running them in-process means the
 * worker shares the webapp's Redis and the live path just works.
 *
 * Importing this module CONSTRUCTS the workers, which starts them
 * consuming. It's split out of `./workers` for exactly that reason: the
 * trigger.dev deployment needs these three and none of the other eleven.
 * `./workers` re-exports them, so the BullMQ deployment still gets a
 * single instance of each.
 */

import { Worker } from "bullmq";

import { logger } from "~/services/logger.service";
import { getRedisConnection } from "../connection";
import { agentTurnQueue, caseQueue, scratchpadScanQueue } from "../queues";
import {
  setupWorkerLogging,
  startPeriodicMetricsLogging,
} from "../utils/worker-logger";
import {
  type RunAgentTurnPayload,
  processAgentTurn,
} from "~/jobs/conversation/run-agent-turn.logic";
import {
  type ScratchpadScanPayload,
  processScratchpadScan,
} from "~/jobs/scratchpad/scratchpad-scan.logic";
import { type CasePayload, processCase } from "~/jobs/case/case.logic";

/**
 * Agent-turn worker
 * Runs one specialist agent's turn on a conversation after a mention has
 * reserved a placeholder row. Cancellable via job-finder — dispatchMentions
 * calls the cancel path when a fresh mention supersedes an in-flight turn.
 */
export const agentTurnWorker = new Worker(
  "agent-turn-queue",
  async (job) => {
    const payload = job.data as RunAgentTurnPayload;
    return await processAgentTurn(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

/**
 * Scratchpad scan worker
 * Processes mention and proactive scratchpad scan jobs
 */
export const scratchpadScanWorker = new Worker(
  "scratchpad-scan-queue",
  async (job) => {
    const payload = job.data as ScratchpadScanPayload;
    return await processScratchpadScan(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

/**
 * CASE pipeline worker — single worker for every non-user trigger that flows
 * through the decision pipeline. Dispatch happens inside `processCase` based
 * on `payload.type` ("activity" | "memory_ingest").
 */
export const caseWorker = new Worker(
  "case-queue",
  async (job) => {
    const payload = job.data as CasePayload;
    return await processCase(payload);
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  },
);

/** The always-on set, paired with their queues for logging and metrics. */
export const ALWAYS_ON_WORKERS = [
  { worker: agentTurnWorker, queue: agentTurnQueue, name: "agent-turn" },
  {
    worker: scratchpadScanWorker,
    queue: scratchpadScanQueue,
    name: "scratchpad-scan",
  },
  { worker: caseWorker, queue: caseQueue, name: "case" },
];

let metricsInterval: NodeJS.Timeout | null = null;

/**
 * Attach logging to the always-on workers. They're already consuming by the
 * time this runs — constructing a Worker starts it — so this only wires up
 * observability.
 *
 * `withMetrics` is for the trigger.dev deployment, where these are the only
 * workers running and nothing else starts a metrics interval. Under
 * QUEUE_PROVIDER=bullmq, `initWorkers` folds them into its own interval and
 * passes false.
 *
 * Lives here rather than in ../start-workers so that starting these three
 * doesn't drag in that module's top-level import of ./index — which would
 * construct (and therefore start) all eleven of the provider-dependent
 * workers on a trigger.dev deployment.
 */
export function initAlwaysOnWorkers({ withMetrics = false } = {}): void {
  for (const { worker, queue, name } of ALWAYS_ON_WORKERS) {
    setupWorkerLogging(worker, queue, name);
  }

  if (withMetrics) {
    metricsInterval = startPeriodicMetricsLogging(ALWAYS_ON_WORKERS, 60000);
  }

  logger.log("\n🚀 Always-on BullMQ workers started (QUEUE_PROVIDER-independent)");
  logger.log("─".repeat(80));
  for (const { worker } of ALWAYS_ON_WORKERS) {
    logger.log(`✓ ${worker.name} (concurrency: 5)`);
  }
  logger.log("─".repeat(80));
}

/**
 * Close just the always-on workers. `closeAllWorkers` in ./index covers these
 * too; this is for the trigger.dev deployment where they're all that runs.
 */
export async function closeAlwaysOnWorkers(): Promise<void> {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  await Promise.all([
    agentTurnWorker.close(),
    scratchpadScanWorker.close(),
    caseWorker.close(),
  ]);
}
