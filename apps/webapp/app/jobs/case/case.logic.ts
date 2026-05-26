/**
 * CASE Pipeline Job
 *
 * One background job for every non-user trigger that flows through the
 * decision pipeline. Dispatch is by the `type` discriminator on the payload:
 *
 *   type: "activity"       → integration webhook activities
 *   type: "memory_ingest"  → Mac session compact summaries
 *
 * Each branch builds its own Trigger object and hands the same downstream
 * (runCASEPipeline + Watch Rules + butler) the right shape. Adding a new
 * trigger source = add a new branch here; no new queue / worker / Trigger.dev
 * task per source.
 */

import { env } from "~/env.server";
import { buildDecisionContext } from "~/services/agent/context/decision-context";
import {
  runCASEPipeline,
  type CASEPipelineResult,
} from "~/services/agent/decision-agent-pipeline";
import { getWorkspacePersona } from "~/models/workspace.server";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { CoreClient } from "@redplanethq/sdk";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import type {
  WebhookTrigger,
  MemoryIngestTrigger,
} from "~/services/agent/types/decision-agent";
import type { MessageChannel } from "~/services/agent/types";

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface ActivityCaseData {
  integrationAccountId: string;
  accountId: string; // human-readable identifier (e.g. email, username)
  workspaceId: string;
  userId: string;
  userEmail: string;
  integrationSlug: string;
  activitiesText: string;
  timezone: string;
}

export interface MemoryIngestData {
  workspaceId: string;
  userId: string;
  userEmail: string;
  source: string; // currently "mac"
  sessionId: string;
  documentId: string;
  /** "created" on first compact for this session, "updated" on re-compacts.
   * Decided by the producer (session-compaction) at enqueue time and frozen
   * for the bucket — not re-derived at run time. */
  kind: "created" | "updated";
  timezone: string;
  // NOTE: title/summary/episodeCount are intentionally NOT in the payload.
  // The job is throttled to one fire per documentId per 10 minutes, so the
  // payload that gets enqueued at T+0 would be stale by the time the job
  // runs at T+600s if Slack keeps re-compacting the session in between.
  // The worker re-reads the Document at run time so the decision agent
  // always sees the latest compact.
}

export type CasePayload =
  | ({ type: "activity" } & ActivityCaseData)
  | ({ type: "memory_ingest" } & MemoryIngestData);

// Legacy alias so existing callers / typing keep working without churn.
export type ActivityCasePayload = ActivityCaseData;

// ---------------------------------------------------------------------------
// Entry point — dispatch by `type`
// ---------------------------------------------------------------------------

export async function processCase(
  payload: CasePayload,
): Promise<{ success: boolean; error?: string }> {
  if (payload.type === "activity") {
    return runActivityCase(payload);
  }
  if (payload.type === "memory_ingest") {
    return runMemoryIngestCase(payload);
  }
  // exhaustiveness guard — TS narrows `payload` to never here
  const _exhaustive: never = payload;
  return {
    success: false,
    error: `Unknown case payload type: ${JSON.stringify(_exhaustive)}`,
  };
}

// ---------------------------------------------------------------------------
// Internal: integration webhook → CASE
// ---------------------------------------------------------------------------

async function runActivityCase(
  payload: ActivityCaseData,
): Promise<{ success: boolean; error?: string }> {
  const {
    integrationAccountId,
    accountId,
    workspaceId,
    userId,
    userEmail,
    integrationSlug,
    activitiesText,
    timezone,
  } = payload;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const metadata = user?.metadata as Record<string, unknown> | null;
    const defaultChannel: MessageChannel =
      (metadata?.defaultChannel as MessageChannel | undefined) ?? "email";

    const trigger: WebhookTrigger = {
      type: "integration_webhook",
      timestamp: new Date(),
      userId,
      workspaceId,
      channel: defaultChannel,
      data: {
        integration: integrationSlug,
        integrationAccountId,
        accountId,
        eventType: "activity_sync",
        text: activitiesText,
        payload: {},
      },
    };

    const [context, userPersona] = await Promise.all([
      buildDecisionContext(trigger, timezone ?? "UTC"),
      getWorkspacePersona(workspaceId),
    ]);

    const { token } = await getOrCreatePersonalAccessToken({
      name: "case-internal",
      userId,
      workspaceId,
      returnDecrypted: true,
    });

    const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
    const executorTools = new HttpOrchestratorTools(client);

    const result: CASEPipelineResult = await runCASEPipeline({
      trigger,
      context,
      userPersona: userPersona?.content,
      userData: { userId, email: userEmail, workspaceId },
      reminderText: activitiesText,
      reminderId: integrationAccountId,
      timezone: timezone ?? "UTC",
      executorTools,
    });

    if (!result.success) {
      logger.error(`[case/activity] Pipeline failed for ${integrationAccountId}`, {
        error: result.error,
      });
    }
    return { success: result.success, error: result.error };
  } catch (error) {
    logger.error(`[case/activity] Failed for ${integrationAccountId}`, { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal: memory ingest (Mac session compact) → CASE
// ---------------------------------------------------------------------------

async function runMemoryIngestCase(
  payload: MemoryIngestData,
): Promise<{ success: boolean; error?: string }> {
  const {
    workspaceId,
    userId,
    userEmail,
    source,
    sessionId,
    documentId,
    kind,
    timezone,
  } = payload;

  logger.info(
    `[case/memory_ingest] Firing for document ${documentId} (session=${sessionId}, source=${source}, kind=${kind})`,
  );

  try {
    // Read the latest compact for this document fresh. The payload was
    // captured 10 minutes ago when the first compact in this bucket fired;
    // any subsequent re-compacts (e.g. Slack ingesting every 5s) have
    // upserted the same Document row with richer content. Always operate
    // on the latest state, not the snapshot from enqueue time.
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, content: true, metadata: true },
    });

    if (!doc) {
      logger.warn(
        `[case/memory_ingest] Document ${documentId} no longer exists at run time; skipping`,
      );
      return { success: true };
    }

    const docMetadata =
      (doc.metadata as Record<string, unknown> | null) ?? null;
    const episodeCount = (docMetadata?.episodeCount as number) ?? 0;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const defaultChannel: MessageChannel =
      (userMetadata?.defaultChannel as MessageChannel | undefined) ?? "email";

    const trigger: MemoryIngestTrigger = {
      type: "memory_ingest",
      timestamp: new Date(),
      userId,
      workspaceId,
      channel: defaultChannel,
      data: {
        source,
        sessionId,
        documentId,
        title: doc.title,
        summary: doc.content,
        episodeCount,
        kind,
      },
    };

    const [context, userPersona] = await Promise.all([
      buildDecisionContext(trigger, timezone ?? "UTC"),
      getWorkspacePersona(workspaceId),
    ]);

    const { token } = await getOrCreatePersonalAccessToken({
      name: "case-internal",
      userId,
      workspaceId,
      returnDecrypted: true,
    });

    const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
    const executorTools = new HttpOrchestratorTools(client);

    const result: CASEPipelineResult = await runCASEPipeline({
      trigger,
      context,
      userPersona: userPersona?.content,
      userData: { userId, email: userEmail, workspaceId },
      reminderText: doc.content,
      reminderId: documentId,
      timezone: timezone ?? "UTC",
      executorTools,
    });

    if (!result.success) {
      logger.error(
        `[case/memory_ingest] Pipeline failed for document ${documentId}`,
        { error: result.error },
      );
    }
    return { success: result.success, error: result.error };
  } catch (error) {
    logger.error(`[case/memory_ingest] Failed for document ${documentId}`, {
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
