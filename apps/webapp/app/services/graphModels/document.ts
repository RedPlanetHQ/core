import { runQuery } from "~/lib/neo4j.server";
import type { DocumentNode } from "@core/types";

export async function saveDocument(document: DocumentNode): Promise<string> {
  const query = `
    MERGE (d:Document {uuid: $uuid})
    ON CREATE SET
      d.title = $title,
      d.originalContent = $originalContent,
      d.metadata = $metadata,
      d.source = $source,
      d.userId = $userId,
      d.createdAt = $createdAt,
      d.validAt = $validAt,
      d.totalChunks = $totalChunks,
      d.documentId = $documentId,
      d.sessionId = $sessionId
    ON MATCH SET
      d.title = $title,
      d.originalContent = $originalContent,
      d.metadata = $metadata,
      d.source = $source,
      d.validAt = $validAt,
      d.totalChunks = $totalChunks,
      d.documentId = $documentId,
      d.sessionId = $sessionId
    RETURN d.uuid as uuid
  `;

  const params = {
    uuid: document.uuid,
    title: document.title,
    originalContent: document.originalContent,
    metadata: JSON.stringify(document.metadata || {}),
    source: document.source,
    userId: document.userId || null,
    createdAt: document.createdAt.toISOString(),
    validAt: document.validAt.toISOString(),
    totalChunks: document.totalChunks || 0,
    documentId: document.documentId || null,
    sessionId: document.sessionId || null,
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

export async function linkEpisodeToDocument(
  episodeUuid: string,
  documentUuid: string,
  chunkIndex: number,
): Promise<void> {
  const query = `
    MATCH (e:Episode {uuid: $episodeUuid})
    MATCH (d:Document {uuid: $documentUuid})
    MERGE (d)-[r:CONTAINS_CHUNK {chunkIndex: $chunkIndex}]->(e)
    SET e.documentId = $documentUuid,
        e.chunkIndex = $chunkIndex
    RETURN r
  `;

  const params = {
    episodeUuid,
    documentUuid,
    chunkIndex,
  };

  await runQuery(query, params);
}

export async function getDocument(
  documentUuid: string,
): Promise<DocumentNode | null> {
  const query = `
    MATCH (d:Document {uuid: $uuid})
    RETURN d
  `;

  const params = { uuid: documentUuid };
  const result = await runQuery(query, params);

  if (result.length === 0) return null;

  const record = result[0];
  const documentNode = record.get("d");

  return {
    uuid: documentNode.properties.uuid,
    title: documentNode.properties.title,
    originalContent: documentNode.properties.originalContent,
    metadata: JSON.parse(documentNode.properties.metadata || "{}"),
    source: documentNode.properties.source,
    userId: documentNode.properties.userId,
    createdAt: new Date(documentNode.properties.createdAt),
    validAt: new Date(documentNode.properties.validAt),
    totalChunks: documentNode.properties.totalChunks,
  };
}

export async function getDocumentEpisodes(documentUuid: string): Promise<
  Array<{
    episodeUuid: string;
    chunkIndex: number;
    content: string;
  }>
> {
  const query = `
    MATCH (d:Document {uuid: $uuid})-[r:CONTAINS_CHUNK]->(e:Episode)
    RETURN e.uuid as episodeUuid, r.chunkIndex as chunkIndex, e.content as content
    ORDER BY r.chunkIndex ASC
  `;

  const params = { uuid: documentUuid };
  const result = await runQuery(query, params);

  return result.map((record) => ({
    episodeUuid: record.get("episodeUuid"),
    chunkIndex: record.get("chunkIndex"),
    content: record.get("content"),
  }));
}

export async function getUserDocuments(
  userId: string,
  limit: number = 50,
): Promise<DocumentNode[]> {
  const query = `
    MATCH (d:Document {userId: $userId})
    RETURN d
    ORDER BY d.createdAt DESC
    LIMIT $limit
  `;

  const params = { userId, limit };
  const result = await runQuery(query, params);

  return result.map((record) => {
    const documentNode = record.get("d");
    return {
      uuid: documentNode.properties.uuid,
      title: documentNode.properties.title,
      originalContent: documentNode.properties.originalContent,
      metadata: JSON.parse(documentNode.properties.metadata || "{}"),
      source: documentNode.properties.source,
      userId: documentNode.properties.userId,
      createdAt: new Date(documentNode.properties.createdAt),
      validAt: new Date(documentNode.properties.validAt),
      totalChunks: documentNode.properties.totalChunks,
    };
  });
}
