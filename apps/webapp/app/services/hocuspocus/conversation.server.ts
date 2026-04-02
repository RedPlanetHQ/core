import { TiptapTransformer } from "@hocuspocus/transformer";
import * as Y from "yjs";
import {
  hocuspocus,
  updateContentForDocument,
} from "~/services/hocuspocus/content.server";

/**
 * Append TipTap JSON content nodes to an existing page document.
 */
export async function appendToPage(
  pageId: string,
  contentJson: unknown,
): Promise<void> {
  const connection = await hocuspocus.openDirectConnection(pageId, {});
  connection.transact((doc) => {
    const newDoc = TiptapTransformer.toYdoc(contentJson as any, "default");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(newDoc));
  });
  await connection.destroy();
}

/**
 * Upsert a butler response node in a page document by replacing the full page content.
 * Pass the complete updated document JSON.
 */
export async function upsertButlerResponse(
  pageId: string,
  _nodeId: string,
  fullDocJson: unknown,
): Promise<void> {
  await updateContentForDocument(pageId, fullDocJson);
}
