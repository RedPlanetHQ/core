import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import {
  type StatementNode,
  type EntityNode,
  type EpisodicNode,
  type Triple,
} from "@core/types";
import { parseEntityNode } from "./entity";

// Get the graph provider instance
const graphProvider = () => ProviderFactory.getGraphProvider();
// Get the vector provider instance
const vectorProvider = () => ProviderFactory.getVectorProvider();

export async function saveEpisode(episode: EpisodicNode): Promise<string> {
  return graphProvider().saveEpisode(episode);
}

// Get an episode by UUID
export async function getEpisode(
  uuid: string,
  withEmbedding: boolean = false,
): Promise<EpisodicNode | null> {
  return graphProvider().getEpisode(uuid, withEmbedding);
}

// Get recent episodes with optional filters
export async function getRecentEpisodes(params: {
  referenceTime: Date;
  limit: number;
  userId: string;
  source?: string;
  sessionId?: string;
}): Promise<EpisodicNode[]> {
  // Map to provider's expected parameters
  return graphProvider().getRecentEpisodes({
    userId: params.userId,
    limit: params.limit,
    source: params.source,
    sessionId: params.sessionId,
    labelIds: undefined,
    spaceIds: undefined,
  });
}

// Get all episodes for a session ordered by createdAt
export async function getEpisodesBySession(params: {
  sessionId: string;
  userId: string;
}): Promise<EpisodicNode[]> {
  return graphProvider().getEpisodesBySession(params.sessionId, params.userId);
}

export async function searchEpisodesByEmbedding(params: {
  embedding: number[];
  userId: string;
  limit?: number;
  minSimilarity?: number;
}) {
  // Step 1: Search vector provider for similar episode IDs
  const vectorResults = await vectorProvider().search({
    vector: params.embedding,
    limit: params.limit || 100,
    threshold: params.minSimilarity || 0.7,
    namespace: VECTOR_NAMESPACES.EPISODE,
    filter: { userId: params.userId },
  });

  if (vectorResults.length === 0) {
    return [];
  }

  // Step 2: Fetch full episode data from Neo4j
  const episodeUuids = vectorResults.map(r => r.id);
  return await graphProvider().getEpisodes(episodeUuids, params.userId, false);
}

// Delete episode and its related nodes safely using single optimized Cypher
export async function deleteEpisodeWithRelatedNodes(params: {
  episodeUuid: string;
  userId: string;
}): Promise<{
  deleted: boolean;
  episodesDeleted: number;
  statementsDeleted: number;
  entitiesDeleted: number;
  deletedEpisodeUuids: string[];
  deletedStatementUuids: string[];
  deletedEntityUuids: string[];
}> {
  const result = await graphProvider().deleteEpisodeWithRelatedNodes(
    params.episodeUuid,
    params.userId
  );

  return {
    deleted: result.episodesDeleted > 0,
    episodesDeleted: result.episodesDeleted,
    statementsDeleted: result.statementsDeleted,
    entitiesDeleted: result.entitiesDeleted,
    deletedEpisodeUuids: result.deletedEpisodeUuids,
    deletedStatementUuids: result.deletedStatementUuids,
    deletedEntityUuids: result.deletedEntityUuids,
  };
}

export async function getEpisodeStatements(params: {
  episodeUuid: string;
  userId: string;
}): Promise<Omit<StatementNode, "factEmbedding">[]> {
  // Custom logic - get statements from triples
  const triples = await graphProvider().getTriplesForEpisode(
    params.episodeUuid,
    params.userId
  );

  return triples
    .filter(t => t.statement.invalidAt === null)
    .map(t => {
      const { factEmbedding, ...rest } = t.statement;
      return rest;
    });
}

export async function getStatementsInvalidatedByEpisode(params: {
  episodeUuid: string;
  userId: string;
}) {
  return graphProvider().getStatementsInvalidatedByEpisode(params.episodeUuid, params.userId);
}

export async function getEpisodesByUserId(params: {
  userId: string;
  startTime?: string;
  endTime?: string;
}): Promise<EpisodicNode[]> {
  return graphProvider().getEpisodesByUserId({
    userId: params.userId,
    startTime: params.startTime ? new Date(params.startTime) : undefined,
    endTime: params.endTime ? new Date(params.endTime) : undefined,
  });
}

export function parseEpisodicNode(raw: any): EpisodicNode {
  return {
    uuid: raw.uuid,
    content: raw.content,
    contentEmbedding: raw.contentEmbedding || [],
    originalContent: raw.originalContent,
    source: raw.source,
    metadata: raw.metadata ? (typeof raw.metadata === 'string' ? JSON.parse(raw.metadata) : raw.metadata) : {},
    createdAt: new Date(raw.createdAt),
    validAt: new Date(raw.validAt),
    userId: raw.userId,
    labelIds: raw.labelIds || [],
    sessionId: raw.sessionId || undefined,
    recallCount: raw.recallCount || undefined,
    chunkIndex: raw.chunkIndex !== undefined ? raw.chunkIndex : undefined,
    totalChunks: raw.totalChunks || undefined,
    queueId: raw.queueId || undefined,
    type: raw.type || undefined,
    version: raw.version || undefined,
    contentHash: raw.contentHash || undefined,
    previousVersionSessionId: raw.previousVersionSessionId || undefined,
    chunkHashes: raw.chunkHashes || undefined,
  };
}

export async function addLabelToEpisodes(
  labelId: string,
  episodeUuids: string[],
  userId: string,
): Promise<number> {
  await graphProvider().addLabelsToEpisodes(episodeUuids, [labelId], userId);
  return episodeUuids.length; // Optimistic return
}

export async function updateEpisodeLabels(
  episodeUuids: string[],
  labelIds: string[],
  userId: string,
): Promise<number> {
  if (episodeUuids.length === 0) return 0;

  return await graphProvider().addLabelsToEpisodes(episodeUuids, labelIds, userId, true);
}

export async function getSessionEpisodes(
  sessionId: string,
  userId: string,
  limit?: number,
): Promise<EpisodicNode[]> {
  const episodes = await graphProvider().getAllSessionChunks(sessionId, userId);

  if (limit) {
    return episodes.slice(0, limit).reverse(); // DESC order
  }

  return episodes; // ASC order
}

export async function getTriplesForEpisode(
  episodeUuid: string,
  userId: string,
): Promise<Triple[]> {
  return graphProvider().getTriplesForEpisode(episodeUuid, userId);
}

/**
 * Link an episode to an existing statement (for duplicate handling)
 */
export async function linkEpisodeToExistingStatement(
  episodeUuid: string,
  statementUuid: string,
  userId: string,
): Promise<void> {
  return graphProvider().linkEpisodeToStatement(episodeUuid, statementUuid, userId);
}

/**
 * Move all provenance relationships from source statement to target statement
 * Used when consolidating duplicate statements - moves ALL episode links, not just one
 */
export async function moveAllProvenanceToStatement(
  sourceStatementUuid: string,
  targetStatementUuid: string,
  userId: string,
): Promise<number> {
  return graphProvider().moveProvenanceToStatement(
    sourceStatementUuid,
    targetStatementUuid,
    userId
  );
}

/**
 * Get all sessions for a user (replaces getUserDocuments)
 * Returns first episode of each session for session-level metadata
 * @param userId - User ID
 * @param type - Optional filter by episode type (CONVERSATION or DOCUMENT)
 * @param limit - Optional limit on number of sessions
 */
export async function getUserSessions(
  userId: string,
  type?: string,
  limit: number = 50,
): Promise<EpisodicNode[]> {
  return graphProvider().getUserSessions({
    userId,
    type,
    limit,
  });
}

/**
 * Invalidate all statements from a previous document version
 * Marks statements as invalid but keeps episodes for version history
 * Optionally filter by specific chunk indices for differential invalidation
 */
export async function invalidateStatementsFromPreviousVersion(params: {
  sessionId: string;
  userId: string;
  previousVersion: number;
  invalidatedBy: string;
  invalidatedAt?: Date;
  changedChunkIndices?: number[]; // Optional: only invalidate statements from specific chunks
}): Promise<{
  invalidatedCount: number;
  statementUuids: string[];
}> {
  const invalidatedAt = params.invalidatedAt || new Date();

  return graphProvider().invalidateStatementsFromPreviousVersion(
    params.sessionId,
    params.userId,
    params.previousVersion,
    params.invalidatedBy,
    invalidatedAt,
    params.changedChunkIndices
  );
}
