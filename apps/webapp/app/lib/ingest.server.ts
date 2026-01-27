// lib/ingest.server.ts
import { IngestionStatus } from "@core/database";
import { EpisodeType } from "@core/types";
import { type z } from "zod";
import { prisma } from "~/db.server";
import {
  estimateCreditsFromTokens,
  reserveCredits,
} from "~/services/billing.server";
import { countTokens } from "~/services/search/tokenBudget";
import { type IngestBodyRequest } from "~/trigger/ingest/ingest";
import { enqueuePreprocessEpisode } from "~/lib/queue-adapter.server";
import { trackFeatureUsage } from "~/services/telemetry.server";

// Used in the server
export const addToQueue = async (
  rawBody: z.infer<typeof IngestBodyRequest>,
  userId: string,
  workspaceId: string,
  activityId?: string,
  ingestionQueueId?: string,
) => {
  const body = { ...rawBody, source: rawBody.source.toLowerCase() };
  const sessionId = body.sessionId || crypto.randomUUID();

  // Filter out invalid labels if labelIds are provided
  let validatedLabelIds: string[] = [];
  if (body.labelIds && body.labelIds.length > 0) {
    // Get only the valid labels for this workspace
    const validLabels = await prisma.label.findMany({
      where: {
        id: {
          in: body.labelIds,
        },
        workspaceId: workspaceId,
      },
      select: {
        id: true,
      },
    });

    validatedLabelIds = validLabels.map((label) => label.id);
  }

  let labels: string[] = validatedLabelIds.length > 0 ? validatedLabelIds : [];
  let title = body.title;

  if (sessionId) {
    const lastEpisode = await prisma.ingestionQueue.findFirst({
      where: {
        sessionId,
        workspaceId: workspaceId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (lastEpisode?.labels && lastEpisode?.labels.length > 0) {
      labels = lastEpisode?.labels;
    }

    if (body.type === "DOCUMENT" && lastEpisode?.title) {
      title = lastEpisode?.title;
    }
  }

  // Estimate credits from input tokens and reserve upfront
  const inputTokens = countTokens(body.episodeBody);
  const estimatedCredits = estimateCreditsFromTokens(inputTokens);

  // Create queue record first so we can track NO_CREDITS status for retry
  const queuePersist = await prisma.ingestionQueue.upsert({
    where: {
      id: ingestionQueueId || "non-existent-id", // Use provided ID or dummy ID to force create
    },
    update: {
      data: body,
      type: body.type,
      status: IngestionStatus.PENDING,
      error: null,
    },
    create: {
      data: body,
      type: body.type,
      source: body.source,
      status: IngestionStatus.PENDING,
      priority: 1,
      workspaceId: workspaceId,
      activityId,
      sessionId,
      labels,
      title,
    },
  });

  // Attempt to reserve credits
  const reserved = await reserveCredits(workspaceId, estimatedCredits);

  if (reserved === 0) {
    // Mark as NO_CREDITS so it can be retried after purchase
    await prisma.ingestionQueue.update({
      where: { id: queuePersist.id },
      data: {
        status: IngestionStatus.NO_CREDITS,
        error:
          "Insufficient credits. Please upgrade your plan or wait for your credits to reset.",
      },
    });
    throw new Error("no credits");
  }

  // Store reserved amount for reconciliation later
  await prisma.ingestionQueue.update({
    where: { id: queuePersist.id },
    data: {
      output: { reservedCredits: reserved },
    },
  });

  // Use preprocessing flow for all types (preprocessing handles chunking, versioning, then enqueues ingestion)
  const handler = await enqueuePreprocessEpisode(
    {
      body: {
        ...body,
        sessionId,
      },
      userId,
      workspaceId: workspaceId,
      queueId: queuePersist.id,
    },
    rawBody.delay,
  );

  // Track feature usage
  if (body.type === EpisodeType.DOCUMENT) {
    trackFeatureUsage("document_ingested", userId).catch(console.error);
  } else {
    trackFeatureUsage("episode_ingested", userId).catch(console.error);
  }

  return { id: handler.id };
};

export { IngestBodyRequest };
