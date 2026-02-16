import { type Prisma, type Document } from "@prisma/client";

import { addToQueue } from "~/lib/ingest.server";
import { prisma } from "~/trigger/utils/prisma";

export interface DocumentSearchParams {
  query?: string;
  labelIds?: string[];
  limit?: number;
}

export interface DocumentSearchResult {
  id: string;
  sessionId: string | null;
  title: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Search documents by text (title/content) and/or labelIds
 * Returns full document info - useful for cmd+k search
 */
export const searchDocuments = async (
  workspaceId: string,
  params: DocumentSearchParams,
): Promise<DocumentSearchResult[]> => {
  const { query, labelIds, limit = 50 } = params;

  const conditions: Prisma.DocumentWhereInput[] = [
    { workspaceId },
    { deleted: null },
  ];

  // Text search on title and content
  if (query && query.trim()) {
    conditions.push({
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  // Filter by labelIds (document must have at least one of the specified labels)
  if (labelIds && labelIds.length > 0) {
    conditions.push({
      labelIds: { hasSome: labelIds },
    });
  }

  const documents = await prisma.document.findMany({
    where: { AND: conditions },
    select: {
      id: true,
      sessionId: true,
      title: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  return documents;
};

/**
 * Search documents and return only sessionIds
 * Optimized for graph filtering - minimal data transfer
 */
export const searchDocumentSessionIds = async (
  workspaceId: string,
  params: DocumentSearchParams,
): Promise<string[]> => {
  const { query, labelIds, limit = 100 } = params;

  const conditions: Prisma.DocumentWhereInput[] = [
    { workspaceId },
    { deleted: null },
    { sessionId: { not: null } },
  ];

  // Text search on title and content
  if (query && query.trim()) {
    conditions.push({
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  // Filter by labelIds
  if (labelIds && labelIds.length > 0) {
    conditions.push({
      labelIds: { hasSome: labelIds },
    });
  }

  const documents = await prisma.document.findMany({
    where: { AND: conditions },
    select: { sessionId: true },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  // Deduplicate sessionIds
  return [...new Set(documents.map((d) => d.sessionId as string))];
};

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

  if (!document) {
    return null;
  }

  const [latestIngestionLog, ingestionQueueCount] = await Promise.all([
    await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: document.sessionId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    await prisma.ingestionQueue.count({
      where: {
        sessionId: document.sessionId,
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

export const getDocumentForSession = async (
  sessionId: string,
  workspaceId: string,
) => {
  const document = await prisma.document.findUnique({
    where: {
      sessionId_workspaceId: {
        sessionId,
        workspaceId,
      },
    },
  });

  if (!document) {
    return null;
  }

  const [latestIngestionLog, ingestionQueueCount] = await Promise.all([
    await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: document.sessionId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    await prisma.ingestionQueue.count({
      where: {
        sessionId: document.sessionId,
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
  // Try to get v2 persona first
  const v2Document = await prisma.document.findFirst({
    where: {
      title: "Persona",
      source: "persona-v2",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (v2Document) {
    return v2Document.id;
  }

  // Fall back to v1 persona if v2 doesn't exist
  const v1Document = await prisma.document.findFirst({
    where: {
      title: "Persona",
      source: "persona",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return v1Document?.id;
};

export const getPersonaDocumentForUser = async (workspaceId: string) => {
  // Try to get v2 persona first
  const v2Document = await prisma.document.findFirst({
    where: {
      title: "Persona",
      source: "persona-v2",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (v2Document) {
    return v2Document.content;
  }

  // Fall back to v1 persona if v2 doesn't exist
  const v1Document = await prisma.document.findFirst({
    where: {
      title: "Persona",
      source: "persona",
      workspaceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return v1Document?.content;
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
      workspaceId,
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

  await prisma.document.update({
    where: {
      id,
      workspaceId,
    },
    data: {
      content,
    },
  });

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
      title: document.title,
      sessionId: document?.sessionId as string,
      source: document.source ?? "core",
      referenceTime: new Date().toISOString(),
      delay: true,
    };

    const newLog = await addToQueue(newLogData, userId, workspaceId);

    return {
      success: true,
      message: "Document created successfully",
      logId: newLog.id,
      action: "created",
    };
  }
};
