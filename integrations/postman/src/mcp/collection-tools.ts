import { z } from "zod";

import { postmanGet } from "../utils";

export const ListCollectionsSchema = z.object({
  workspaceId: z.string().optional().describe("Filter by Postman workspace id."),
});

export const GetCollectionSchema = z.object({
  collectionUid: z.string().describe("Postman collection uid (e.g. 12345-...)."),
});

export async function listCollections(args: z.infer<typeof ListCollectionsSchema>, apiKey: string) {
  const params = args.workspaceId ? { workspace: args.workspaceId } : undefined;
  const res = await postmanGet<{ collections: any[] }>("/collections", apiKey, params);
  const list = res.collections ?? [];
  if (list.length === 0) {
    return { content: [{ type: "text", text: "No collections found." }] };
  }
  const text =
    `Found ${list.length} collection(s):\n\n` +
    list
      .map(
        (c) =>
          `- ${c.name}\n  uid: ${c.uid}\n  updated: ${c.updatedAt ?? "?"}` +
          (c.fork?.label ? `\n  fork: ${c.fork.label}` : "")
      )
      .join("\n\n");
  return { content: [{ type: "text", text }] };
}

export async function getCollection(args: z.infer<typeof GetCollectionSchema>, apiKey: string) {
  const res = await postmanGet<{ collection: any }>(`/collections/${args.collectionUid}`, apiKey);
  const c = res.collection;
  const requestCount = countRequests(c.item ?? []);
  const lines = [
    `Collection: ${c.info?.name ?? "(unnamed)"}`,
    `  id:          ${c.info?._postman_id ?? args.collectionUid}`,
    `  schema:      ${c.info?.schema ?? "(unknown)"}`,
    `  requests:    ${requestCount}`,
    `  description: ${c.info?.description ?? "(none)"}`,
    `  item:        ${JSON.stringify(c.item ?? [], null, 2)}`,
    `  event:       ${JSON.stringify(c.event ?? [], null, 2)}`,
    `  variable:    ${JSON.stringify(c.variable ?? [], null, 2)}`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function countRequests(items: any[]): number {
  let n = 0;
  for (const item of items) {
    if (item.request) n += 1;
    if (Array.isArray(item.item)) n += countRequests(item.item);
  }
  return n;
}
