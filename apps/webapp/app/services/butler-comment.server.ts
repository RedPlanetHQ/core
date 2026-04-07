import * as Y from "yjs";
import { prisma } from "~/db.server";

/**
 * Walk a Yjs XmlFragment/XmlElement tree and find the Y.XmlText node
 * containing `needle`, returning the node and the character offset within it.
 */
function findTextNode(
  node: Y.XmlFragment | Y.XmlElement,
  needle: string,
): { textNode: Y.XmlText; startOffset: number } | null {
  let result: { textNode: Y.XmlText; startOffset: number } | null = null;

  node.forEach((child) => {
    if (result) return;

    if (child instanceof Y.XmlText) {
      const str = child.toString();
      const idx = str.indexOf(needle);
      if (idx !== -1) {
        result = { textNode: child, startOffset: idx };
      }
    } else if (child instanceof Y.XmlElement) {
      result = findTextNode(child, needle);
    }
  });

  return result;
}

export async function createButlerComment(
  workspaceId: string,
  pageId: string,
  selectedText: string,
  content: string,
  conversationId?: string,
) {
  // Default: create without position anchors
  let relativeStart: object | null = null;
  let relativeEnd: object | null = null;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { descriptionBinary: true },
  });

  if (page?.descriptionBinary) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(page.descriptionBinary));
    const fragment = doc.getXmlFragment("default");

    const found = findTextNode(fragment, selectedText);
    if (found) {
      relativeStart = Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(found.textNode, found.startOffset),
      );
      relativeEnd = Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(
          found.textNode,
          found.startOffset + selectedText.length,
        ),
      );
    }
  }

  return prisma.butlerComment.create({
    data: {
      workspaceId,
      pageId,
      selectedText,
      content,
      conversationId,
      relativeStart: relativeStart ?? undefined,
      relativeEnd: relativeEnd ?? undefined,
    },
  });
}
