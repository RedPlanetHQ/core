import { IngestionStatus } from "@prisma/client";
import { type z } from "zod";
import { type IngestBodyRequest } from "../ingest/ingest";

import { hasCredits } from "./utils";
import { preprocessTask } from "../ingest/preprocess-episode";
import { LabelService } from "~/services/label.server";
import { prisma } from "~/db.server";

// Used in the trigger
export const addToQueue = async (
  body: z.infer<typeof IngestBodyRequest>,
  userId: string,
  workspaceId: string,
  activityId?: string,
  ingestionQueueId?: string,
) => {
  if (!workspaceId) {
    throw new Error(
      "Workspace ID is required to create an ingestion queue entry.",
    );
  }

  // Check if workspace has sufficient credits before processing
  const hasSufficientCredits = await hasCredits(
    workspaceId,
    userId,
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

  // Validate label access if labelIds are provided
  if (body.labelIds && body.labelIds.length > 0) {
    const labelService = new LabelService();
    const hasAccess = await labelService.validateLabelAccess(
      body.labelIds,
      workspaceId,
    );

    if (!hasAccess) {
      throw new Error(
        "One or more labels are invalid or not accessible in this workspace",
      );
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
      workspaceId: workspaceId,
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
      workspaceId,
      queueId: queuePersist.id,
    },
    {
      concurrencyKey: workspaceId,
      tags: [workspaceId, userId, queuePersist.id],
    },
  );

  return { id: handler?.id };
};
