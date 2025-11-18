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
import type { LabelAssignmentPayload } from "~/jobs/labels/label-assignment.logic";
import type { TitleGenerationPayload } from "~/jobs/titles/title-generation.logic";

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
  delay: boolean;
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
      ...(payload.delay ? { delay: "5m" } : {}),
    });
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { documentIngestQueue } = await import("~/bullmq/queues");
    const job = await documentIngestQueue.add("ingest-document", payload, {
      jobId: payload.queueId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      // If delay is true, schedule job to run after 5 minutes (300000 ms)
      ...(payload.delay ? { delay: 5 * 60 * 1000 } : {}),
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
  // BullMQ
  const { sessionCompactionQueue } = await import("~/bullmq/queues");
  const job = await sessionCompactionQueue.add("session-compaction", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
  return { id: job.id };
}

/**
 * Enqueue BERT topic analysis job
 * Always uses BullMQ regardless of QUEUE_PROVIDER setting
 */
export async function enqueueBertTopicAnalysis(payload: {
  userId: string;
  workspaceId: string;
  minTopicSize?: number;
  nrTopics?: number;
}): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { bertTopicAnalysisTask } = await import("~/trigger/bert/bert");
    const handler = await bertTopicAnalysisTask.trigger(payload, {
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

/**
 * Enqueue persona generation job
 */
export async function enqueuePersonaGeneration(payload: {
  userId: string;
  workspaceId: string;
  labelId: string;
  mode: "full" | "incremental";
  startTime?: string;
}): Promise<{ id?: string; token?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { personaGenerationTask } = await import(
      "~/trigger/spaces/persona-generation"
    );
    const handler = await personaGenerationTask.trigger(payload);
    return { id: handler.id, token: handler.publicAccessToken };
  } else {
    // BullMQ
    const { personaGenerationQueue } = await import("~/bullmq/queues");
    const job = await personaGenerationQueue.add(
      "persona-generation",
      payload,
      {
        jobId: `persona-${payload.userId}-${Date.now()}`,
        attempts: 2, // Only 2 attempts for expensive operations
        backoff: { type: "exponential", delay: 5000 },
      },
    );
    return { id: job.id };
  }
}

/* Enqueue label assignment job
 */
export async function enqueueLabelAssignment(
  payload: LabelAssignmentPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { labelAssignmentTask } = await import(
      "~/trigger/labels/label-assignment"
    );
    const handler = await labelAssignmentTask.trigger(payload, {
      tags: [payload.userId, "label-assignment"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { labelAssignmentQueue } = await import("~/bullmq/queues");
    const job = await labelAssignmentQueue.add("label-assignment", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

/**
 * Enqueue title generation job
 */
export async function enqueueTitleGeneration(
  payload: TitleGenerationPayload,
): Promise<{ id?: string }> {
  const provider = env.QUEUE_PROVIDER as QueueProvider;

  if (provider === "trigger") {
    const { titleGenerationTask } = await import(
      "~/trigger/titles/title-generation"
    );
    const handler = await titleGenerationTask.trigger(payload, {
      tags: [payload.userId, "title-generation"],
    });
    return { id: handler.id };
  } else {
    // BullMQ
    const { titleGenerationQueue } = await import("~/bullmq/queues");
    const job = await titleGenerationQueue.add("title-generation", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    return { id: job.id };
  }
}

export const isTriggerDeployment = () => {
  return env.QUEUE_PROVIDER === "trigger";
};
