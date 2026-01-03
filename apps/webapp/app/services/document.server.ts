import { type Document } from "@prisma/client";
import { prisma } from "~/db.server";
import { addToQueue } from "~/lib/ingest.server";

interface DocumentUpdateParams {
  labelIds?: string[];
  title?: string;
}

export const getDocument = async (id: string, workspaceId: string) => {
  const document = await prisma.document.findUnique({
    where: {
      id,
      workspaceId,
    },
  });

  const [latestIngestionLog, ingestionQueueCount] = await Promise.all([
    await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: document?.sessionId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    await prisma.ingestionQueue.count({
      where: {
        sessionId: document?.sessionId,
      },
    }),
  ]);

  return {
    ...document,
    latestIngestionLog,
    ingestionQueueCount,
    error: latestIngestionLog?.error,
    status: latestIngestionLog?.status,
  };
};

export const updateDocument = async (
  id: string,
  workspaceId: string,
  updateData: DocumentUpdateParams,
) => {
  return await prisma.document.update({
    where: {
      id,
      workspaceId,
    },
    data: {
      title: updateData.title,
      labelIds: updateData.labelIds,
    },
  });
};

export const deleteDocument = async (id: string, workspaceId: string) => {
  return await prisma.document.delete({
    where: {
      id,
      workspaceId,
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

export const updateDocumentContent = async (
  document: Document,
  content: string,
  userId: string,
  workspaceId: string,
) => {
  const id = document.id;

  // Find the latest document-type log for this session
  const latestDocumentLog = await prisma.ingestionQueue.findFirst({
    where: {
      sessionId: document.sessionId,
      type: "DOCUMENT",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);
  // Check if we should update existing or create new
  const shouldUpdate =
    latestDocumentLog &&
    (latestDocumentLog.status === "PENDING" ||
      latestDocumentLog.status === "FAILED") &&
    latestDocumentLog.createdAt > fourMinutesAgo;

  if (shouldUpdate && latestDocumentLog) {
    // Update existing document log
    const existingData = latestDocumentLog.data as any;
    const updatedData = {
      ...existingData,
      episodeBody: content,
    };

    await prisma.ingestionQueue.update({
      where: { id: latestDocumentLog.id },
      data: { data: updatedData },
    });

    await prisma.document.update({
      where: {
        id,
        workspaceId,
      },
      data: {
        content,
      },
    });

    return {
      success: true,
      message: "Document updated successfully",
      logId: latestDocumentLog.id,
      action: "updated",
    };
  } else {
    // Create new document log
    const newLogData = {
      type: "DOCUMENT",
      episodeBody: content,
      sessionId: document?.sessionId as string,
      source: document.source ?? "core",
      referenceTime: new Date().toISOString(),
      delay: true,
    };

    const newLog = await addToQueue(newLogData, userId);

    return {
      success: true,
      message: "Document created successfully",
      logId: newLog.id,
      action: "created",
    };
  }
};
