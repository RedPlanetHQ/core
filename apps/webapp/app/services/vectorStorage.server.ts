/**
 * Embedding Storage Service
 *
 * Centralized service for storing and retrieving embeddings from the vector provider.
 * This separates embedding storage from graph storage (Neo4j).
 *
 * Architecture:
 * - Embeddings stored in vector provider (pgvector/qdrant/turbopuffer)
 * - Graph structure stored in Neo4j
 * - This service is the single source of truth for embedding operations
 */

import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import { logger } from "./logger.service";
import { type EpisodeEmbedding } from "@core/database";

/**
 * Get vector provider instance
 */
const vectorProvider = () => ProviderFactory.getVectorProvider();

/**
 * Batch store entity embeddings in vector provider (much faster than individual upserts)
 */
export async function batchStoreEntityEmbeddings(
  entities: Array<{
    uuid: string;
    name: string;
    embedding: number[];
    userId: string;
  }>,
  workspaceId: string,
): Promise<void> {
  if (entities.length === 0) return;

  try {
    const items = entities.map((entity) => ({
      id: entity.uuid,
      vector: entity.embedding,
      content: entity.name,
      metadata: { userId: entity.userId, type: "entity", workspaceId },
    }));

    await vectorProvider().batchUpsert(items, VECTOR_NAMESPACES.ENTITY);
  } catch (error) {
    logger.error(
      `Failed to batch store ${entities.length} entity embeddings:`,
      { error },
    );
    throw error;
  }
}

/**
 * Get entity name embedding from vector provider
 */
export async function getEntityEmbedding(
  entityUuid: string,
): Promise<number[] | null> {
  try {
    return await vectorProvider().get({
      id: entityUuid,
      namespace: VECTOR_NAMESPACES.ENTITY,
    });
  } catch (error) {
    logger.error(`Failed to get entity embedding for ${entityUuid}:`, {
      error,
    });
    return null;
  }
}

/**
 * Batch get entity embeddings from vector provider
 */
export async function batchGetEntityEmbeddings(
  entityUuids: string[],
): Promise<Map<string, number[]>> {
  try {
    return await vectorProvider().batchGet({
      ids: entityUuids,
      namespace: VECTOR_NAMESPACES.ENTITY,
    });
  } catch (error) {
    logger.error(`Failed to batch get entity embeddings:`, { error });
    return new Map();
  }
}

/**
 * Delete entity embedding from vector provider
 */
export async function deleteEntityEmbedding(entityUuid: string): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: [entityUuid],
      namespace: VECTOR_NAMESPACES.ENTITY,
    });
  } catch (error) {
    logger.error(`Failed to delete entity embedding for ${entityUuid}:`, {
      error,
    });
  }
}

/**
 * Batch delete entity embeddings from vector provider
 */
export async function batchDeleteEntityEmbeddings(
  entityUuids: string[],
): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: entityUuids,
      namespace: VECTOR_NAMESPACES.ENTITY,
    });
  } catch (error) {
    logger.error(`Failed to batch delete entity embeddings:`, { error });
  }
}

// ==================== STATEMENT EMBEDDINGS ====================

/**
 * Store statement fact embedding in vector provider
 */
export async function storeStatementEmbedding(
  statementUuid: string,
  fact: string,
  embedding: number[],
  userId: string,
): Promise<void> {
  try {
    await vectorProvider().upsert({
      id: statementUuid,
      vector: embedding,
      content: fact,
      namespace: VECTOR_NAMESPACES.STATEMENT,
      metadata: { userId, type: "statement" },
    });
  } catch (error) {
    logger.error(`Failed to store statement embedding for ${statementUuid}:`, {
      error,
    });
    throw error;
  }
}

/**
 * Batch store statement embeddings in vector provider (much faster than individual upserts)
 */
export async function batchStoreStatementEmbeddings(
  statements: Array<{
    uuid: string;
    fact: string;
    embedding: number[];
    userId: string;
  }>,
  workspaceId: string,
): Promise<void> {
  if (statements.length === 0) return;

  try {
    const items = statements.map((statement) => ({
      id: statement.uuid,
      vector: statement.embedding,
      content: statement.fact,
      metadata: { userId: statement.userId, type: "statement", workspaceId },
    }));

    await vectorProvider().batchUpsert(items, VECTOR_NAMESPACES.STATEMENT);
  } catch (error) {
    logger.error(
      `Failed to batch store ${statements.length} statement embeddings:`,
      { error },
    );
    throw error;
  }
}

/**
 * Get statement fact embedding from vector provider
 */
export async function getStatementEmbedding(
  statementUuid: string,
): Promise<number[] | null> {
  try {
    return await vectorProvider().get({
      id: statementUuid,
      namespace: VECTOR_NAMESPACES.STATEMENT,
    });
  } catch (error) {
    logger.error(`Failed to get statement embedding for ${statementUuid}:`, {
      error,
    });
    return null;
  }
}

/**
 * Batch get statement embeddings from vector provider
 */
export async function batchGetStatementEmbeddings(
  statementUuids: string[],
): Promise<Map<string, number[]>> {
  try {
    return await vectorProvider().batchGet({
      ids: statementUuids,
      namespace: VECTOR_NAMESPACES.STATEMENT,
    });
  } catch (error) {
    logger.error(`Failed to batch get statement embeddings:`, { error });
    return new Map();
  }
}

/**
 * Delete statement embedding from vector provider
 */
export async function deleteStatementEmbedding(
  statementUuid: string,
): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: [statementUuid],
      namespace: VECTOR_NAMESPACES.STATEMENT,
    });
  } catch (error) {
    logger.error(`Failed to delete statement embedding for ${statementUuid}:`, {
      error,
    });
  }
}

/**
 * Batch delete statement embeddings from vector provider
 */
export async function batchDeleteStatementEmbeddings(
  statementUuids: string[],
): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: statementUuids,
      namespace: VECTOR_NAMESPACES.STATEMENT,
    });
  } catch (error) {
    logger.error(`Failed to batch delete statement embeddings:`, { error });
  }
}

// ==================== EPISODE EMBEDDINGS ====================

/**
 * Store episode content embedding in vector provider
 */
export async function storeEpisodeEmbedding(
  episodeUuid: string,
  content: string,
  embedding: number[],
  userId: string,
  workspaceId: string,
  queueId: string,
  labelIds: string[],
  sessionId?: string,
  version?: number,
  chunkIndex?: number,
): Promise<void> {
  try {
    await vectorProvider().upsert({
      id: episodeUuid,
      vector: embedding,
      content: content,
      namespace: VECTOR_NAMESPACES.EPISODE,
      metadata: {
        userId,
        type: "episode",
        ingestionQueueId: queueId,
        labelIds: labelIds,
        sessionId: sessionId,
        version: version,
        chunkIndex,
        workspaceId,
      },
    });
  } catch (error) {
    logger.error(`Failed to store episode embedding for ${episodeUuid}:`, {
      error,
    });
    throw error;
  }
}

/**
 * Get episode content embedding from vector provider
 */
export async function getEpisodeEmbedding(
  episodeUuid: string,
): Promise<number[] | null> {
  try {
    return await vectorProvider().get({
      id: episodeUuid,
      namespace: VECTOR_NAMESPACES.EPISODE,
    });
  } catch (error) {
    logger.error(`Failed to get episode embedding for ${episodeUuid}:`, {
      error,
    });
    return null;
  }
}

/**
 * Batch get episode embeddings from vector provider
 */
export async function batchGetEpisodeEmbeddings(
  episodeUuids: string[],
): Promise<Map<string, number[]>> {
  try {
    return await vectorProvider().batchGet({
      ids: episodeUuids,
      namespace: VECTOR_NAMESPACES.EPISODE,
    });
  } catch (error) {
    logger.error(`Failed to batch get episode embeddings:`, { error });
    return new Map();
  }
}

/**
 * Delete episode embedding from vector provider
 */
export async function deleteEpisodeEmbedding(
  episodeUuid: string,
): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: [episodeUuid],
      namespace: VECTOR_NAMESPACES.EPISODE,
    });
  } catch (error) {
    logger.error(`Failed to delete episode embedding for ${episodeUuid}:`, {
      error,
    });
  }
}

/**
 * Batch delete episode embeddings from vector provider
 */
export async function batchDeleteEpisodeEmbeddings(
  episodeUuids: string[],
): Promise<void> {
  try {
    await vectorProvider().delete({
      ids: episodeUuids,
      namespace: VECTOR_NAMESPACES.EPISODE,
    });
  } catch (error) {
    logger.error(`Failed to batch delete episode embeddings:`, { error });
  }
}

export async function updateEpisodeLabels(
  episodeUuids: string[],
  labelId: string,
  userId: string,
  workspaceId: string,
  forceUpdate: boolean = false,
): Promise<number> {
  return await vectorProvider().addLabelsToEpisodes(
    episodeUuids,
    [labelId],
    userId,
    workspaceId,
    forceUpdate,
  );
}

export async function updateEpisodeLabelsBySessionId(
  sessionId: string,
  labelId: string,
  userId: string,
  workspaceId: string,
  forceUpdate: boolean = false,
): Promise<number> {
  return await vectorProvider().addLabelsToEpisodesBySessionId(
    sessionId,
    [labelId],
    userId,
    workspaceId,
    forceUpdate,
  );
}

export async function getEpisodeByQueueId(
  queueId: string,
): Promise<EpisodeEmbedding[]> {
  return await vectorProvider().getEpisodesByQueueId(queueId);
}

export async function getRecentEpisodes(
  userId: string,
  limit: number,
  sessionId?: string,
  excludeIds?: string[],
  version?: number,
  workspaceId?: string,
): Promise<EpisodeEmbedding[]> {
  return await vectorProvider().getRecentEpisodes(
    userId,
    limit,
    sessionId,
    excludeIds,
    version,
    workspaceId,
  );
}

// ==================== SEARCH OPERATIONS ====================

/**
 * Search for similar statements by vector similarity
 */
export async function searchStatements(params: {
  queryVector: number[];
  userId: string;
  workspaceId: string;
  labelIds?: string[];
  threshold?: number;
  limit?: number;
  excludeIds?: string[];
}): Promise<Array<{ uuid: string; score: number }>> {
  try {
    const results = await vectorProvider().search({
      vector: params.queryVector,
      namespace: VECTOR_NAMESPACES.STATEMENT,
      limit: params.limit || 100,
      threshold: params.threshold || 0.5,
      filter: {
        userId: params.userId,
        labelIds: params.labelIds,
        excludeIds: params.excludeIds,
        workspaceId: params.workspaceId,
      },
    });

    return results.map((r) => ({ uuid: r.id, score: r.score }));
  } catch (error) {
    logger.error(`Failed to search statements:`, { error });
    throw error;
  }
}

/**
 * Search for similar episodes by vector similarity
 */
export async function searchEpisodes(params: {
  queryVector: number[];
  userId: string;
  workspaceId: string;
  labelIds?: string[];
  threshold?: number;
  limit?: number;
  excludeIds?: string[];
}): Promise<Array<{ uuid: string; score: number }>> {
  try {
    const results = await vectorProvider().search({
      vector: params.queryVector,
      namespace: VECTOR_NAMESPACES.EPISODE,
      limit: params.limit || 50,
      threshold: params.threshold || 0.2,
      filter: {
        userId: params.userId,
        workspaceId: params.workspaceId,
        labelIds: params.labelIds,
        excludeIds: params.excludeIds,
      },
    });

    return results.map((r) => ({ uuid: r.id, score: r.score }));
  } catch (error) {
    logger.error(`Failed to search episodes:`, { error });
    throw error;
  }
}

/**
 * Search for similar entities by vector similarity
 */
export async function searchEntities(params: {
  queryVector: number[];
  userId: string;
  workspaceId: string;
  threshold?: number;
  limit?: number;
  excludeIds?: string[];
}): Promise<Array<{ uuid: string; score: number }>> {
  try {
    const results = await vectorProvider().search({
      vector: params.queryVector,
      namespace: VECTOR_NAMESPACES.ENTITY,
      limit: params.limit || 10,
      threshold: params.threshold || 0.5,
      filter: {
        userId: params.userId,
        excludeIds: params.excludeIds,
        workspaceId: params.workspaceId,
      },
    });

    return results.map((r) => ({ uuid: r.id, score: r.score }));
  } catch (error) {
    logger.error(`Failed to search entities:`, { error });
    throw error;
  }
}

/**
 * Batch score statements against query vector
 * Useful for scoring specific statements found via graph traversal
 */
export async function batchScoreStatements(params: {
  queryVector: number[];
  statementIds: string[];
  userId: string;
}): Promise<Map<string, number>> {
  try {
    return await vectorProvider().batchScore({
      vector: params.queryVector,
      ids: params.statementIds,
      namespace: VECTOR_NAMESPACES.STATEMENT,
    });
  } catch (error) {
    logger.error(`Failed to batch score statements:`, { error });
    throw error;
  }
}
