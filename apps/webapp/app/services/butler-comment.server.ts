import { prisma } from "~/db.server";

export async function createButlerComment(
  workspaceId: string,
  pageId: string,
  selectedText: string,
  content: string,
  conversationId?: string,
) {
  return prisma.butlerComment.create({
    data: { workspaceId, pageId, selectedText, content, conversationId },
  });
}

export async function getCommentsForPage(pageId: string, includeResolved = false) {
  return prisma.butlerComment.findMany({
    where: { pageId, ...(includeResolved ? {} : { resolved: false }) },
    orderBy: { createdAt: "asc" },
  });
}

export async function resolveComment(commentId: string) {
  return prisma.butlerComment.update({
    where: { id: commentId },
    data: { resolved: true, resolvedAt: new Date() },
  });
}

export async function getCommentById(commentId: string) {
  return prisma.butlerComment.findUnique({ where: { id: commentId } });
}
