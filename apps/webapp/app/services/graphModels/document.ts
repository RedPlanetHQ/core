import { runQuery } from "~/lib/neo4j.server";
import type { DocumentNode } from "@core/types";
import crypto from "crypto";

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
      d.sessionId = $sessionId,
      d.version = $version,
      d.contentHash = $contentHash,
      d.previousVersionUuid = $previousVersionUuid,
      d.chunkHashes = $chunkHashes
    ON MATCH SET
      d.title = $title,
      d.originalContent = $originalContent,
      d.metadata = $metadata,
      d.source = $source,
      d.validAt = $validAt,
      d.totalChunks = $totalChunks,
      d.sessionId = $sessionId,
      d.version = $version,
      d.contentHash = $contentHash,
      d.previousVersionUuid = $previousVersionUuid,
      d.chunkHashes = $chunkHashes
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
    sessionId: document.sessionId || null,
    version: document.version || 1,
    contentHash: document.contentHash,
    previousVersionUuid: document.previousVersionUuid || null,
    chunkHashes: document.chunkHashes || [],
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
    SET e.chunkIndex = $chunkIndex
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
    version: documentNode.properties.version || 1,
    contentHash: documentNode.properties.contentHash || "",
    previousVersionUuid: documentNode.properties.previousVersionUuid || null,
    chunkHashes: documentNode.properties.chunkHashes || [],
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
    LIMIT ${limit}
  `;

  const params = { userId };
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
      version: documentNode.properties.version || 1,
      contentHash: documentNode.properties.contentHash || "",
      previousVersionUuid: documentNode.properties.previousVersionUuid || null,
      chunkHashes: documentNode.properties.chunkHashes || [],
    };
  });
}

/**
 * Generate content hash for document versioning
 */
export function generateContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Find existing document by documentId and userId for version comparison
 */
export async function findExistingDocument(
  sessionId: string,
  userId: string,
): Promise<DocumentNode | null> {
  const query = `
    MATCH (d:Document {sessionId: $sessionId, userId: $userId})
    RETURN d
    ORDER BY d.version DESC
    LIMIT 1
  `;

  const params = { sessionId, userId };
  const result = await runQuery(query, params);

  if (result.length === 0) return null;

  const documentNode = result[0].get("d");
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
    version: documentNode.properties.version || 1,
    contentHash: documentNode.properties.contentHash || "",
    previousVersionUuid: documentNode.properties.previousVersionUuid || null,
    chunkHashes: documentNode.properties.chunkHashes || [],
  };
}

/**
 * Get document version history
 */
export async function getDocumentVersions(
  sessionId: string,
  userId: string,
  limit: number = 10,
): Promise<DocumentNode[]> {
  const query = `
    MATCH (d:Document {sessionId: $sessionId, userId: $userId})
    RETURN d
    ORDER BY d.version DESC
    LIMIT ${limit}
  `;

  const params = { sessionId, userId };
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
      version: documentNode.properties.version || 1,
      contentHash: documentNode.properties.contentHash || "",
      previousVersionUuid: documentNode.properties.previousVersionUuid || null,
      chunkHashes: documentNode.properties.chunkHashes || [],
    };
  });
}

/**
 * Delete a document and all its related episodes, statements, and entities efficiently
 * Uses optimized Cypher patterns for bulk deletion
 *
 * @throws Error if attempting to delete a persona document
 */
export async function deleteDocument(documentUuid: string): Promise<{
  documentsDeleted: number;
  episodesDeleted: number;
  statementsDeleted: number;
  entitiesDeleted: number;
}> {
  // First, check if this is a persona document
  const documentCheck = await getDocument(documentUuid);

  if (!documentCheck) {
    return {
      documentsDeleted: 0,
      episodesDeleted: 0,
      statementsDeleted: 0,
      entitiesDeleted: 0,
    };
  }

  // Prevent deletion of persona documents
  if (
    documentCheck.title === "Persona" ||
    documentCheck.metadata?.isPersona === true
  ) {
    throw new Error(
      "Cannot delete persona document. Persona documents are system-managed and cannot be deleted.",
    );
  }

  const query = `
    MATCH (d:Document {uuid: $documentUuid})

    // Get all related data first
    OPTIONAL MATCH (d)-[:CONTAINS_CHUNK]->(e:Episode)
    OPTIONAL MATCH (e)-[:CONTAINS]->(s:Statement)
    OPTIONAL MATCH (s)-[:REFERENCES]->(entity:Entity)

    // Count entities that will become orphaned
    WITH d, collect(DISTINCT e) as episodes, collect(DISTINCT s) as statements, collect(DISTINCT entity) as entities
    UNWIND entities as entity
    OPTIONAL MATCH (entity)<-[:REFERENCES]-(otherStmt:Statement)
    WHERE NOT otherStmt IN statements

    WITH d, episodes, statements,
         collect(CASE WHEN otherStmt IS NULL THEN entity ELSE null END) as orphanedEntities

    // Delete statements (breaks references to entities)
    FOREACH (stmt IN statements | DETACH DELETE stmt)

    // Delete orphaned entities only (filter nulls first)
    WITH d, episodes, statements, [entity IN orphanedEntities WHERE entity IS NOT NULL] as validOrphanedEntities
    FOREACH (entity IN validOrphanedEntities | DETACH DELETE entity)

    // Delete episodes
    FOREACH (episode IN episodes | DETACH DELETE episode)

    // Delete document
    DETACH DELETE d

    RETURN
      1 as documentsDeleted,
      size(episodes) as episodesDeleted,
      size(statements) as statementsDeleted,
      size(validOrphanedEntities) as entitiesDeleted
  `;

  try {
    const result = await runQuery(query, { documentUuid });

    if (result.length === 0) {
      return {
        documentsDeleted: 0,
        episodesDeleted: 0,
        statementsDeleted: 0,
        entitiesDeleted: 0,
      };
    }

    const record = result[0];
    return {
      documentsDeleted: record.get("documentsDeleted") || 0,
      episodesDeleted: record.get("episodesDeleted") || 0,
      statementsDeleted: record.get("statementsDeleted") || 0,
      entitiesDeleted: record.get("entitiesDeleted") || 0,
    };
  } catch (error) {
    console.error("Error deleting document:", error);
    throw error;
  }
}

export async function getDocumentsByTitle(
  userId: string,
  title: string,
): Promise<DocumentNode[]> {
  const query = `
    MATCH (d:Document {userId: $userId, title: $title})
    RETURN d
    ORDER BY d.createdAt DESC
  `;

  const params = { userId, title };
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
      version: documentNode.properties.version || 1,
      contentHash: documentNode.properties.contentHash || "",
      previousVersionUuid: documentNode.properties.previousVersionUuid || null,
      chunkHashes: documentNode.properties.chunkHashes || [],
    };
  });
}

/**
 * Get user's persona content for AI chat context
 * Returns null if persona doesn't exist or has no content yet
 */
export async function getUserPersonaContent(
  userId: string,
): Promise<string | null> {
  try {
    const personaDocs = await getDocumentsByTitle(userId, "Persona");

    if (!personaDocs || personaDocs.length === 0) {
      return null;
    }

    const personaContent = personaDocs[0]?.originalContent;

    // Return null if it's just the initial placeholder content
    if (!personaContent || personaContent.trim() === "# Persona") {
      return null;
    }

    return personaContent;
  } catch (error) {
    console.error("Error fetching persona content:", error);
    return null;
  }
}

/**
 * Create initial persona document for a user
 * Called during user signup/onboarding
 */
export async function createPersonaDocument(
  userId: string,
  workspaceId: string,
): Promise<DocumentNode> {
  const uuid = crypto.randomUUID();
  const now = new Date();
  const initialContent = "# Persona";

  const personaDocument: DocumentNode = {
    uuid,
    title: "Persona",
    originalContent: initialContent,
    metadata: {
      workspaceId,
      isPersona: true,
    },
    source: "persona",
    userId,
    createdAt: now,
    validAt: now,
    totalChunks: 0,
    sessionId: `persona-${workspaceId}`,
    version: 1,
    contentHash: generateContentHash(initialContent),
    chunkHashes: [],
  };

  await saveDocument(personaDocument);

  return personaDocument;
}
