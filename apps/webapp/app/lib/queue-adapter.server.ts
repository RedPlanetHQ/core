/**
 * Queue Adapter
 *
 * This module provides a unified interface for queueing background jobs,
 * supporting both Trigger.dev and BullMQ backends based on the QUEUE_PROVIDER
 * environment variable.
 *
 * Usage:
 * - Set QUEUE_PROVIDER="trigger" for Trigger.dev (default, good for production scaling)
 * - Set QUEUE_PROVIDER="bullmq" for BullMQ (good for open-source deployments)
 */

import { env } from "~/env.server";
import type { z } from "zod";
import type { IngestBodyRequest } from "~/jobs/ingest/ingest-episode.logic";
import type { CreateConversationTitlePayload } from "~/jobs/conversation/create-title.logic";
import type { ProcessDeepSearchPayload } from "~/jobs/deep-search/deep-search.logic";
import type { SessionCompactionPayload } from "~/jobs/session/session-compaction.logic";

type QueueProvider = "trigger" | "bullmq";

/**
 * Enqueue episode ingestion job
 */
export async function enqueueIngestEpisode(payload: {
  body: z.infer<typeof IngestBodyRequest>;
  userId: string;
  workspaceId: string;
  queueId: string;
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { ingestTask } = await import("~/trigger/ingest/ingest");
    const handler = await ingestTask.trigger(payload, {
      queue: "ingestion-queue",
      concurrencyKey: payload.userId,
      tags: [payload.userId, payload.queueId],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { ingestQueue } = await import("~/bullmq/queues");
    const job = await ingestQueue.add("ingest-episode", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue document ingestion job
 */
export async function enqueueIngestDocument(payload: {
  body: z.infer<typeof IngestBodyRequest>;
  userId: string;
  workspaceId: string;
  queueId: string;
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { ingestDocumentTask } = await import(
      "~/trigger/ingest/ingest-document"
    );
    const handler = await ingestDocumentTask.trigger(payload, {
      queue: "document-ingestion-queue",
      concurrencyKey: payload.userId,
      tags: [payload.userId, payload.queueId],
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { documentIngestQueue } = await import("~/bullmq/queues");
    const job = await documentIngestQueue.add("ingest-document", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });

    return { id: job.id };
  }
}

/**
 * Enqueue conversation title creation job
 */
export async function enqueueCreateConversationTitle(
  payload: CreateConversationTitlePayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { createConversationTitle } = await import(
      "~/trigger/conversation/create-conversation-title"
    );
    const handler = await createConversationTitle.trigger(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { conversationTitleQueue } = await import("~/bullmq/queues");
    const job = await conversationTitleQueue.add(
      "create-conversation-title",
      payload,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
    return { id: job.id };
  }
}

/**
 * Enqueue deep search job
 */
export async function enqueueDeepSearch(
  payload: ProcessDeepSearchPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { deepSearch } = await import("~/trigger/deep-search");
    const handler = await deepSearch.trigger({
      content: payload.content,
      userId: payload.userId,
      stream: true,
      metadata: payload.metadata,
      intentOverride: payload.intentOverride,
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { deepSearchQueue } = await import("~/bullmq/queues");
    const job = await deepSearchQueue.add("deep-search", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue session compaction job
 */
export async function enqueueSessionCompaction(
  payload: SessionCompactionPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { sessionCompactionTask } = await import(
      "~/trigger/session/session-compaction"
    );
    const handler = await sessionCompactionTask.trigger(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { sessionCompactionQueue } = await import("~/bullmq/queues");
    const job = await sessionCompactionQueue.add(
      "session-compaction",
      payload,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
    return { id: job.id };
  }
}

/**
 * Enqueue space assignment job
 * (Helper for common job logic to call)
 */
export async function enqueueSpaceAssignment(payload: {
  userId: string;
  workspaceId: string;
  mode: "episode";
  episodeIds: string[];
}): Promise<void> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { triggerSpaceAssignment } = await import(
      "~/trigger/spaces/space-assignment"
    );
    await triggerSpaceAssignment(payload);
  } else {
    // For BullMQ, space assignment is not implemented yet
    // You can add it later when needed
    console.warn("Space assignment not implemented for BullMQ yet");
  }
}

export const isTriggerDeployment = () => {
  return env.QUEUE_PROVIDER === "trigger";
};
