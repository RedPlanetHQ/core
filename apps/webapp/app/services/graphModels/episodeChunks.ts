import { runQuery } from "~/lib/neo4j.server";
import { EPISODIC_NODE_PROPERTIES, type EpisodicNode } from "@core/types";
import { logger } from "../logger.service";
import { parseEpisodicNode } from "./episode";

/**
 * Adjacent episode chunks result
 */
export interface AdjacentChunks {
  matchedChunk: EpisodicNode;
  previousChunk?: EpisodicNode;
  nextChunk?: EpisodicNode;
}

/**
 * Get an episode with its adjacent chunks for context
 * Returns matched episode plus ±N surrounding chunks from the same session
 */
export async function getEpisodeWithAdjacentChunks(
  episodeUuid: string,
  userId: string,
  contextWindow: number = 1,
): Promise<AdjacentChunks> {
  // First get the matched episode to find its sessionId and chunkIndex
  const matchedQuery = `
    MATCH (matched:Episode {uuid: $episodeUuid, userId: $userId})
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
  `;

  const matchedResult = await runQuery(matchedQuery, { episodeUuid, userId });

  if (matchedResult.length === 0) {
    throw new Error(`Episode not found: ${episodeUuid}`);
  }

  const matchedChunk = parseEpisodicNode(matchedResult[0].get("episode"));

  // If no sessionId or chunkIndex, return only matched chunk
  if (!matchedChunk.sessionId || matchedChunk.chunkIndex === undefined) {
    logger.warn(`Episode has no sessionId or chunkIndex, returning without adjacent chunks`, {
      episodeUuid,
    });
    return {
      matchedChunk,
      previousChunk: undefined,
      nextChunk: undefined,
    };
  }

  // Get adjacent chunks based on context window
  const minIndex = Math.max(0, matchedChunk.chunkIndex - contextWindow);
  const maxIndex = matchedChunk.chunkIndex + contextWindow;

  const adjacentQuery = `
    MATCH (e:Episode {
      userId: $userId,
      sessionId: $sessionId
    })
    WHERE e.chunkIndex >= $minIndex
      AND e.chunkIndex <= $maxIndex
      AND e.chunkIndex <> $matchedChunkIndex
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY e.chunkIndex ASC
  `;

  const adjacentResult = await runQuery(adjacentQuery, {
    userId,
    sessionId: matchedChunk.sessionId,
    minIndex,
    maxIndex,
    matchedChunkIndex: matchedChunk.chunkIndex,
  });

  const adjacentChunks = adjacentResult.map((record) =>
    parseEpisodicNode(record.get("episode"))
  );

  // Find previous and next chunks
  const previousChunk = adjacentChunks.find(
    (chunk) => chunk.chunkIndex === matchedChunk.chunkIndex? - 1 : undefined,
  );

  const nextChunk = adjacentChunks.find(
    (chunk) => chunk.chunkIndex === matchedChunk.chunkIndex? + 1 : undefined,
  );

  return {
    matchedChunk,
    previousChunk,
    nextChunk,
  };
}

/**
 * Get all episodes in a session, ordered by chunkIndex
 */
export async function getAllSessionChunks(
  sessionId: string,
  userId: string,
): Promise<EpisodicNode[]> {
  const query = `
    MATCH (e:Episode {sessionId: $sessionId, userId: $userId})
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    ORDER BY e.chunkIndex ASC
  `;

  const result = await runQuery(query, { sessionId, userId });

  return result.map((record) => parseEpisodicNode(record.get("episode")));
}

/**
 * Get session metadata from first episode (chunkIndex=0)
 */
export async function getSessionMetadata(
  sessionId: string,
  userId: string,
): Promise<EpisodicNode | null> {
  const query = `
    MATCH (e:Episode {sessionId: $sessionId, userId: $userId})
    WHERE e.chunkIndex = 0
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode
    LIMIT 1
  `;

  const result = await runQuery(query, { sessionId, userId });

  if (result.length === 0) {
    return null;
  }

  return parseEpisodicNode(result[0].get("episode"));
}

/**
 * Delete all episodes in a session
 * Handles related statements and entities (orphan cleanup)
 */
export async function deleteSession(
  sessionId: string,
  userId: string,
): Promise<{
  deleted: boolean;
  episodesDeleted: number;
  statementsDeleted: number;
  entitiesDeleted: number;
}> {
  const query = `
    MATCH (e:Episode {sessionId: $sessionId, userId: $userId})

    // Get all related data first
    OPTIONAL MATCH (e)-[:HAS_PROVENANCE]->(s:Statement)
    OPTIONAL MATCH (s)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)

    // Collect all related nodes
    WITH e, collect(DISTINCT s) as statements, collect(DISTINCT entity) as entities

    // Find orphaned entities (only connected to statements we're deleting)
    UNWIND CASE WHEN size(entities) = 0 THEN [null] ELSE entities END as entity
    OPTIONAL MATCH (entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(otherStmt:Statement)
    WHERE entity IS NOT NULL AND NOT otherStmt IN statements

    WITH e, statements,
         collect(CASE WHEN entity IS NOT NULL AND otherStmt IS NULL THEN entity ELSE null END) as orphanedEntities

    // Delete statements
    FOREACH (stmt IN statements | DETACH DELETE stmt)

    // Delete orphaned entities only
    WITH e, statements, [entity IN orphanedEntities WHERE entity IS NOT NULL] as validOrphanedEntities
    FOREACH (entity IN validOrphanedEntities | DETACH DELETE entity)

    // Delete episodes
    WITH collect(e) as episodes, statements, validOrphanedEntities
    FOREACH (episode IN episodes | DETACH DELETE episode)

    RETURN
      true as deleted,
      size(episodes) as episodesDeleted,
      size(statements) as statementsDeleted,
      size(validOrphanedEntities) as entitiesDeleted
  `;

  try {
    const result = await runQuery(query, { sessionId, userId });

    if (result.length === 0) {
      return {
        deleted: false,
        episodesDeleted: 0,
        statementsDeleted: 0,
        entitiesDeleted: 0,
      };
    }

    const record = result[0];
    return {
      deleted: record.get("deleted") || false,
      episodesDeleted: record.get("episodesDeleted") || 0,
      statementsDeleted: record.get("statementsDeleted") || 0,
      entitiesDeleted: record.get("entitiesDeleted") || 0,
    };
  } catch (error) {
    logger.error("Error deleting session:", {error});
    throw error;
  }
}

/**
 * Reconstruct content from chunks
 */
export function reconstructContentFromChunks(chunks: EpisodicNode[]): string {
  return chunks
    .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0))
    .map((chunk) => chunk.content)
    .join("\n\n");
}

/**
 * Format chunks with context for display
 */
export function formatChunksWithContext(chunks: EpisodicNode[]): string {
  const sorted = chunks.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));

  return sorted
    .map((chunk, idx) => {
      const header = chunk.chunkIndex !== undefined
        ? `## Section ${chunk.chunkIndex + 1}`
        : `## Part ${idx + 1}`;

      return `${header}\n\n${chunk.content}`;
    })
    .join("\n\n");
}
