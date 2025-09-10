// lib/ingest.queue.ts
import { IngestionStatus } from "@core/database";
import { EpisodeType } from "@core/types";
import { type z } from "zod";
import { prisma } from "~/db.server";
import { type IngestBodyRequest, ingestTask } from "~/trigger/ingest/ingest";
import { ingestDocumentTask } from "~/trigger/ingest/ingest-document";

export const addToQueue = async (
  rawBody: z.infer<typeof IngestBodyRequest>,
  userId: string,
  activityId?: string,
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

  const queuePersist = await prisma.ingestionQueue.create({
    data: {
      spaceId: body.spaceId ? body.spaceId : null,
      data: body,
      type: body.type,
      status: IngestionStatus.PENDING,
      priority: 1,
      workspaceId: user.Workspace.id,
      activityId,
    },
  });

  let handler;
  if (body.type === EpisodeType.DOCUMENT) {
    handler = await ingestDocumentTask.trigger(
      {
        body,
        userId,
        workspaceId: user.Workspace.id,
        queueId: queuePersist.id,
      },
      {
        queue: "document-ingestion-queue",
        concurrencyKey: userId,
        tags: [user.id, queuePersist.id],
      },
    );
  } else if (body.type === EpisodeType.CONVERSATION) {
    handler = await ingestTask.trigger(
      {
        body,
        userId,
        workspaceId: user.Workspace.id,
        queueId: queuePersist.id,
      },
      {
        queue: "ingestion-queue",
        concurrencyKey: userId,
        tags: [user.id, queuePersist.id],
      },
    );
  }

  return { id: handler?.id, token: handler?.publicAccessToken };
};

export { IngestBodyRequest };
