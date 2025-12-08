// lib/ingest.server.ts
import { IngestionStatus } from "@core/database";
import { EpisodeType } from "@core/types";
import { type z } from "zod";
import { prisma } from "~/db.server";
import { hasCredits } from "~/services/billing.server";
import { type IngestBodyRequest } from "~/trigger/ingest/ingest";
import { enqueuePreprocessEpisode } from "~/lib/queue-adapter.server";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { LabelService } from "~/services/label.server";

// Used in the server
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

  // Filter out invalid labels if labelIds are provided
  let validatedLabelIds: string[] = [];
  if (body.labelIds && body.labelIds.length > 0) {
    // Get only the valid labels for this workspace
    const validLabels = await prisma.label.findMany({
      where: {
        id: {
          in: body.labelIds,
        },
        workspaceId: user.Workspace.id,
      },
      select: {
        id: true,
      },
    });

    validatedLabelIds = validLabels.map((label) => label.id);
  }

  let labels: string[] = validatedLabelIds.length > 0 ? validatedLabelIds : [];
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

  // Use preprocessing flow for all types (preprocessing handles chunking, versioning, then enqueues ingestion)
  const handler = await enqueuePreprocessEpisode(
    {
      body,
      userId,
      workspaceId: user.Workspace.id,
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

  return { id: handler?.id, publicAccessToken: handler?.token };
};

export { IngestBodyRequest };
