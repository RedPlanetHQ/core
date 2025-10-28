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
import type { SessionCompactionPayload } from "~/jobs/session/session-compaction.logic";
import type { SpaceAssignmentPayload } from "~/jobs/spaces/space-assignment.logic";
import type { SpaceSummaryPayload } from "~/jobs/spaces/space-summary.logic";

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
 */
export async function enqueueSpaceAssignment(
  payload: SpaceAssignmentPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { triggerSpaceAssignment } = await import(
      "~/trigger/spaces/space-assignment"
    );
    const handler = await triggerSpaceAssignment(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { spaceAssignmentQueue } = await import("~/bullmq/queues");
    const job = await spaceAssignmentQueue.add("space-assignment", payload, {
      jobId: `space-assignment-${payload.userId}-${payload.mode}-${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue space summary job
 */
export async function enqueueSpaceSummary(
  payload: SpaceSummaryPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { triggerSpaceSummary } = await import(
      "~/trigger/spaces/space-summary"
    );
    const handler = await triggerSpaceSummary(payload);
    return { id: handler.id };
  } else {
    // BullMQ
    const { spaceSummaryQueue } = await import("~/bullmq/queues");
    const job = await spaceSummaryQueue.add("space-summary", payload, {
      jobId: `space-summary-${payload.spaceId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue BERT topic analysis job
 */
export async function enqueueBertTopicAnalysis(payload: {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { bertTopicAnalysisTask } = await import(
      "~/trigger/bert/topic-analysis"
    );
    const handler = await bertTopicAnalysisTask.trigger(payload, {
      queue: "bert-topic-analysis",
      concurrencyKey: payload.userId,
      tags: [payload.userId, "bert-analysis"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { bertTopicQueue } = await import("~/bullmq/queues");
    const job = await bertTopicQueue.add("topic-analysis", payload, {
      jobId: `bert-${payload.userId}-${Date.now()}`,
      attempts: 2, // Only 2 attempts for expensive operations
      backoff: { type: "exponential", delay: 5000 },
    });
    return { id: job.id };
  }
}

export const isTriggerDeployment = () => {
  return env.QUEUE_PROVIDER === "trigger";
};
