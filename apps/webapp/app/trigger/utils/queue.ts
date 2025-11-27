import { IngestionStatus } from "@prisma/client";
import { type z } from "zod";
import { type IngestBodyRequest } from "../ingest/ingest";
import { prisma } from "./prisma";
import { hasCredits } from "./utils";
import { preprocessTask } from "../ingest/preprocess-episode";

// Used in the trigger
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

  // Use unified episode ingestion flow for all types
  const handler = await preprocessTask.trigger(
    {
      body,
      userId,
      workspaceId: user.Workspace.id,
      queueId: queuePersist.id,
    },
    {
      concurrencyKey: userId,
      tags: [userId, queuePersist.id],
    },
  );

  return { id: handler?.id };
};
