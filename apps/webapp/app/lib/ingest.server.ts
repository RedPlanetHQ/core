// lib/ingest.queue.ts
import { IngestionStatus } from "@core/database";
import { EpisodeType } from "@core/types";
import { type z } from "zod";
import { prisma } from "~/db.server";
import { hasCredits } from "~/services/billing.server";
import { type IngestBodyRequest } from "~/trigger/ingest/ingest";
import {
  enqueueIngestDocument,
  enqueueIngestEpisode,
} from "~/lib/queue-adapter.server";
import { trackFeatureUsage } from "~/services/telemetry.server";

export const addToQueue = async (
  rawBody: z.infer<typeof IngestBodyRequest>,
  userId: string,
  activityId?: string,
  ingestionQueueId?: string,
) => {
  const body = { ...rawBody, source: rawBody.source.toLowerCase() };
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
    },
    include: {
      Workspace: true,
    },
  });

  if (!user?.Workspace?.id) {
    throw new Error(
      "Workspace ID is required to create an ingestion queue entry.",
    );
  }

  // Check if workspace has sufficient credits before processing
  const hasSufficientCredits = await hasCredits(
    user.Workspace?.id as string,
    "addEpisode",
  );

  if (!hasSufficientCredits) {
    throw new Error("no credits");
  }

  let labels: string[] = body.labelIds ?? [];
  let title = body.title;

  if (body.sessionId) {
    const lastEpisode = await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: body.sessionId,
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

  // Upsert: update existing or create new ingestion queue entry
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
      workspaceId: user.Workspace.id,
      activityId,
      sessionId: body.sessionId,
      labels,
      title,
    },
  });

  let handler;
  if (body.type === EpisodeType.DOCUMENT) {
    handler = await enqueueIngestDocument({
      body,
      userId,
      workspaceId: user.Workspace.id,
      queueId: queuePersist.id,
      delay: body.delay ?? false,
    });

    // Track document ingestion
    trackFeatureUsage("document_ingested", userId).catch(console.error);
  } else {
    handler = await enqueueIngestEpisode({
      body,
      userId,
      workspaceId: user.Workspace.id,
      queueId: queuePersist.id,
    });

    // Track episode ingestion
    trackFeatureUsage("episode_ingested", userId).catch(console.error);
  }

  return { id: handler?.id, publicAccessToken: handler?.token };
};

export { IngestBodyRequest };
