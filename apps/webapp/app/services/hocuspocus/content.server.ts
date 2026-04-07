import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { generateHTML, generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import Heading from "@tiptap/extension-heading";
import type { Extensions } from "@tiptap/core";
import * as Y from "yjs";
import { prisma } from "~/db.server";
import { verifyCollabToken } from "~/services/collab-token.server";
import {
  ButlerTaskExtensionServer,
  CustomTaskItemServer,
} from "~/services/hocuspocus/extensions.server";
import {
  handleScratchpadStore,
  cleanupPage,
} from "~/services/collab-scanner.server";

// Singleton pattern to avoid re-creating across HMR reloads
const globalForHocuspocus = globalThis as unknown as {
  hocuspocusInstance?: Hocuspocus;
};

export const hocuspocus: Hocuspocus =
  globalForHocuspocus.hocuspocusInstance ??
  (globalForHocuspocus.hocuspocusInstance = new Hocuspocus({
    debounce: 3000,
    maxDebounce: 10000,

    async onAuthenticate({ token }) {
      const auth = verifyCollabToken(token);
      if (!auth) throw new Error("Unauthorized");
      return auth;
    },
    async onDisconnect({ documentName, document }) {
      if (document.getConnectionsCount() === 0) {
        cleanupPage(documentName);
      }
    },
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const page = await prisma.page.findUnique({
            where: { id: documentName },
          });
          return page?.descriptionBinary ?? null;
        },
        store: async ({ documentName, document, state }) => {
          console.log(documentName, "store");
          const json = TiptapTransformer.fromYdoc(document, "default");
          const page = await prisma.page.update({
            where: { id: documentName },
            data: {
              descriptionBinary: Buffer.from(state),
              description: JSON.stringify(json),
            },
          });

          if (page.type === "Daily") {
            handleScratchpadStore(documentName, document, {
              workspaceId: page.workspaceId,
              userId: page.userId,
            }).catch((err) => console.error("[collab-store-scratchpad]", err));
          }
        },
      }),
    ],
  }));

/**
 * Returns server-safe TipTap extensions (no React renderers).
 */
export function getServerExtensions(): Extensions {
  return [
    StarterKit,
    TaskList,
    Heading.configure({ levels: [1, 2, 3] }),
    ButlerTaskExtensionServer,
    CustomTaskItemServer,
  ];
}

export function tiptapJsonToHtml(json: unknown): string {
  return generateHTML(
    json as Parameters<typeof generateHTML>[0],
    getServerExtensions(),
  );
}

export function htmlToTiptapJson(html: string): unknown {
  return generateJSON(html, getServerExtensions());
}

/**
 * Programmatically replace a page's Yjs document content.
 */
export async function updateContentForDocument(
  pageId: string,
  json: unknown,
): Promise<void> {
  const connection = await hocuspocus.openDirectConnection(pageId, {});
  connection.transact((doc) => {
    const fragment = doc.getXmlFragment("default");
    if (fragment.length > 0) {
      fragment.delete(0, fragment.length);
    }
    const newDoc = TiptapTransformer.toYdoc(json as any, "default");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
  });
  await connection.disconnect();
}

/**
 * Convert HTML to TipTap JSON and write it to the page's Yjs document.
 */
export async function setPageContentFromHtml(
  pageId: string,
  html: string,
): Promise<void> {
  const json = htmlToTiptapJson(html);
  await updateContentForDocument(pageId, json);
}

/**
 * Surgically set a conversationId attribute on specific fragment indices
 * in the live Hocuspocus Y.Doc. Syncs to all connected clients via WebSocket.
 */
export async function tagConversationOnParagraphs(
  pageId: string,
  fragmentIndices: number[],
  conversationId: string,
): Promise<void> {
  const connection = await hocuspocus.openDirectConnection(pageId, {});
  connection.transact((doc) => {
    const fragment = doc.getXmlFragment("default");
    for (const idx of fragmentIndices) {
      if (idx < 0 || idx >= fragment.length) continue;
      const child = fragment.get(idx);
      if (child instanceof Y.XmlElement) {
        child.setAttribute("conversationId", conversationId);
      }
    }
  });
  await connection.disconnect();
}

/**
 * Read a page's stored JSON (from DB) and return it as HTML.
 * Returns null if the page has no content.
 */
export async function getPageContentAsHtml(
  pageId: string,
): Promise<string | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { description: true },
  });
  if (!page?.description) return null;
  try {
    const json = JSON.parse(page.description);
    return tiptapJsonToHtml(json);
  } catch {
    return null;
  }
}
