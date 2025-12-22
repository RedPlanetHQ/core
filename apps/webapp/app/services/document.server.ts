import { prisma } from "~/db.server";

interface DocumentUpdateParams {
  labelIds?: string[];
  title?: string;
}

export const getDocument = async (id: string, workspaceId: string) => {
  const [latestIngestionLog, ingestionQueueCount] = await Promise.all([
    await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: id,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    await prisma.ingestionQueue.count({
      where: {
        sessionId: id,
      },
    }),
  ]);

  const document = await prisma.document.findUnique({
    where: {
      id,
      workspaceId,
    },
  });

  return {
    ...document,
    latestIngestionLog,
    ingestionQueueCount,
  };
};

export const updateDocument = async (
  id: string,
  updateData: DocumentUpdateParams,
) => {
  return await prisma.document.update({
    where: {
      id,
    },
    data: {
      title: updateData.title,
      labelIds: updateData.labelIds,
    },
  });
};

export const deleteDocument = async (id: string) => {
  return await prisma.document.delete({
    where: {
      id,
    },
  });
};

export const getPersonaForUser = async (workspaceId: string) => {
  const document = await prisma.document.findFirst({
    where: {
      title: "Persona",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return document?.id;
};
