import { IngestionStatus, PrismaClient } from "@prisma/client";
import { type z } from "zod";
import { type IngestBodyRequest, ingestTask } from "../ingest/ingest";
import { prisma } from "./prisma";

export const addToQueue = async (
  body: z.infer<typeof IngestBodyRequest>,
  userId: string,
  activityId?: string,
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

  const handler = await ingestTask.trigger(
    { body, userId, workspaceId: user.Workspace.id, queueId: queuePersist.id },
    {
      queue: "ingestion-queue",
      concurrencyKey: userId,
      tags: [user.id, queuePersist.id],
    },
  );

  return { id: handler.id, token: handler.publicAccessToken };
};
