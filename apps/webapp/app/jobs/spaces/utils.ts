import { prisma } from "~/trigger/utils/prisma";

/**
 * Save or update the persona document directly in the Document table.
 * This does NOT ingest into the graph - the persona is derived FROM the graph,
 * so we only store it for display/retrieval purposes.
 */
export const savePersonaDocument = async (
  workspaceId: string,
  userId: string,
  content: string,
  labelId?: string,
) => {
  const sessionId = `persona-v2-${workspaceId}`;

  const document = await prisma.document.upsert({
    where: {
      sessionId_workspaceId: {
        sessionId,
        workspaceId,
      },
    },
    create: {
      sessionId,
      title: "Persona",
      content,
      labelIds: labelId ? [labelId] : [],
      source: "persona-v2",
      type: "DOCUMENT",
      metadata: {
        generatedAt: new Date().toISOString(),
        version: "v2",
      },
      editedBy: userId,
      workspaceId,
    },
    update: {
      content,
      updatedAt: new Date(),
      metadata: {
        generatedAt: new Date().toISOString(),
        version: "v2",
      },
    },
  });

  return document;
};
