/**
 * Memory Ingest CASE Logic
 *
 * Fires once per session compact (NOT per aspect). When `processSessionCompaction`
 * finishes writing/updating a Document row for a Mac-sourced session, the resulting
 * compact summary is routed through the CASE pipeline. The decision agent reads
 * the summary, applies Watch Rules, and decides whether to surface task suggestions
 * (channel ack + scratchpad append) or stay silent.
 *
 * Mirrors `processActivityCase` for webhooks — same shape, different trigger type.
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
import type { MemoryIngestTrigger } from "~/services/agent/types/decision-agent";
import type { MessageChannel } from "~/services/agent/types";

export interface MemoryIngestPayload {
  workspaceId: string;
  userId: string;
  userEmail: string;
  source: string; // currently "mac" only
  sessionId: string;
  documentId: string;
  title: string;
  summary: string;
  episodeCount: number;
  kind: "created" | "updated";
  timezone: string;
}

export async function processMemoryIngestCase(
  payload: MemoryIngestPayload,
): Promise<{ success: boolean; error?: string }> {
  const {
    workspaceId,
    userId,
    userEmail,
    source,
    sessionId,
    documentId,
    title,
    summary,
    episodeCount,
    kind,
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
        title,
        summary,
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
      reminderText: summary,
      reminderId: documentId,
      timezone: timezone ?? "UTC",
      executorTools,
    });

    if (!result.success) {
      logger.error(
        `[memory-ingest-case] Pipeline failed for document ${documentId}`,
        { error: result.error },
      );
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    logger.error(`[memory-ingest-case] Failed for document ${documentId}`, {
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
