import { IngestionStatus } from "@prisma/client";
import { type z } from "zod";
import { type IngestBodyRequest, ingestTask } from "../ingest/ingest";
import { prisma } from "./prisma";
import { EpisodeType } from "@core/types";
import { ingestDocumentTask } from "../ingest/ingest-document";
import { hasCredits } from "./utils";

export const addToQueue = async (
  body: z.infer<typeof IngestBodyRequest>,
  userId: string,
  activityId?: string,
  ingestionQueueId?: string,
) => {
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
      title: body.title,
    },
  });

  let handler;
  if (body.type === EpisodeType.DOCUMENT) {
    handler = await ingestDocumentTask.trigger({
      body,
      userId,
      workspaceId: user.Workspace.id,
      queueId: queuePersist.id,
    });

    // Track document ingestion
  } else {
    handler = await ingestTask.trigger({
      body,
      userId,
      workspaceId: user.Workspace.id,
      queueId: queuePersist.id,
    });

    // Track episode ingestion
  }

  return { id: handler?.id };
};
