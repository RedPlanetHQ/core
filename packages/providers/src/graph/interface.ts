import type {
  EntityNode,
  EpisodicNode,
  StatementNode,
  Triple,
  SpaceNode,
  SpaceDeletionResult,
  SpaceAssignmentResult,
  CompactedSessionNode,
  AdjacentChunks,
} from "@core/types";
import { RawTriplet } from "./neo4j/types";

/**
 * IGraphProvider - Interface for graph database providers
 *
 * This interface defines all operations that can be performed on a graph database.
 * Currently supports Neo4j, with planned support for FalkorDB and HelixDB.
 *
 * Design Philosophy:
 * - Abstract by INTENT, not by syntax
 * - Each method represents a semantic operation (e.g., saveEntity, findSimilarEntities)
 * - Provider-specific query syntax is hidden inside implementations
 * - This enables true multi-provider support where each DB can optimize queries
 */

export interface IGraphProvider {
  // ===== CORE INFRASTRUCTURE =====

  /**
   * Execute a raw query (Cypher for Neo4j, equivalent for others)
   * Used for complex operations not covered by semantic methods
   */
  runQuery<T = any>(query: string, params?: Record<string, any>): Promise<T[]>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;

  /**
   * Get the provider name (e.g., "neo4j", "falkordb")
   */
  getProviderName(): string;

  /**
   * Health check - verify database is accessible
   */
  ping(): Promise<boolean>;

  /**
   * Check if provider supports embeddings natively
   * (Neo4j stores embeddings as arrays, some providers may not)
   */
  supportsEmbeddings(): boolean;

  /**
   * Get current timestamp from database server
   * Abstracts provider-specific datetime functions
   */
  getCurrentTimestamp(): Promise<Date>;

  // ===== ENTITIES =====

  /**
   * Save or update an entity node
   * @returns Entity UUID
   */
  saveEntity(entity: EntityNode): Promise<string>;

  /**
   * Get entity by UUID
   */
  getEntity(uuid: string, userId: string): Promise<EntityNode | null>;

  /**
   * Get multiple entities by UUIDs in a single query
   *
   * Bulk fetch optimization using UNWIND pattern.
   */
  getEntities(uuids: string[], userId: string): Promise<EntityNode[]>;
  /**
   * Find semantically similar entities using vector similarity
   * @param embedding Query embedding vector
   * @param threshold Minimum similarity score (0-1)
   * @param limit Maximum number of results
   * @returns Array of entities with similarity scores
   */
  findSimilarEntities(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
  }): Promise<Array<{ entity: EntityNode; score: number }>>;

  /**
   * Find exact predicate matches by name (case-insensitive)
   */
  findExactPredicateMatches(params: {
    predicateName: string;
    userId: string;
  }): Promise<EntityNode[]>;

  /**
   * Find exact entity match by name (case-insensitive)
   */
  findExactEntityMatch(params: { entityName: string; userId: string }): Promise<EntityNode | null>;

  /**
   * Merge source entity into target entity
   * Updates all statement relationships and deletes source
   * Idempotent - safe to retry
   */
  mergeEntities(sourceUuid: string, targetUuid: string, userId: string): Promise<void>;

  /**
   * Deduplicate entities with same name for a user
   * @returns Object with count and array of merged (deleted) entity UUIDs
   */
  deduplicateEntitiesByName(userId: string): Promise<{ count: number; deletedUuids: string[] }>;

  /**
   * Delete orphaned entities (entities with no relationships)
   * @returns Object with count and array of deleted entity UUIDs
   */
  deleteOrphanedEntities(userId: string): Promise<{ count: number; deletedUuids: string[] }>;

  /**
   * Get onboarding entities for a user
   */
  getOnboardingEntities(userId: string): Promise<{ predicate: string; object: string }[]>;

  // ===== EPISODES =====

  /**
   * Save or update an episode node
   * @returns Episode UUID
   */
  saveEpisode(episode: EpisodicNode): Promise<string>;

  /**
   * Get episode by UUID
   */
  getEpisode(uuid: string, withEmbedding: boolean): Promise<EpisodicNode | null>;

  /**
   * Get episodes by UUIDs
   */
  getEpisodes(uuids: string[], userId: string, withEmbedding: boolean): Promise<EpisodicNode[]>;

  /**
   * Get episodes by user
   */
  getEpisodesByUser(
    userId: string,
    orderBy?: string,
    limit?: number,
    descending?: boolean
  ): Promise<EpisodicNode[]>;

  /**
   * Get episode count by user
   */
  getEpisodeCountByUser(userId: string, createdAfter?: Date): Promise<number>;

  /**
   * Get recent episodes for a user with optional filters
   */
  getRecentEpisodes(params: {
    userId: string;
    limit: number;
    labelIds?: string[];
    sessionId?: string;
    source?: string;
    spaceIds?: string[];
  }): Promise<EpisodicNode[]>;

  /**
   * Get all episodes in a session ordered by chunkIndex
   */
  getEpisodesBySession(sessionId: string, userId: string): Promise<EpisodicNode[]>;

  /**
   * Delete episode and related orphaned entities
   * @returns Statistics about what was deleted and UUIDs of deleted nodes for embedding cleanup
   */
  deleteEpisodeWithRelatedNodes(
    uuid: string,
    userId: string
  ): Promise<{
    episodesDeleted: number;
    statementsDeleted: number;
    entitiesDeleted: number;
    deletedEpisodeUuids: string[];
    deletedStatementUuids: string[];
    deletedEntityUuids: string[];
  }>;

  /**
   * Search episodes by vector similarity
   */
  searchEpisodesByEmbedding(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
    labelIds?: string[];
    spaceIds?: string[];
  }): Promise<Array<{ episode: EpisodicNode; score: number }>>;

  /**
   * Add labels to episodes
   */
  addLabelsToEpisodes(
    episodeUuids: string[],
    labelIds: string[],
    userId: string,
    workspaceId: string,
    forceUpdate?: boolean
  ): Promise<number>;

  addLabelsToEpisodesBySessionId(
    sessionId: string,
    labelIds: string[],
    userId: string,
    workspaceId: string,
    forceUpdate?: boolean
  ): Promise<number>;

  /**
   * Get episode with adjacent chunks for context
   */
  getEpisodeWithAdjacentChunks(
    episodeUuid: string,
    userId: string,
    contextWindow?: number
  ): Promise<AdjacentChunks>;

  /**
   * Get all episodes in a session ordered by chunkIndex
   * Alias for getEpisodesBySession for consistency
   */
  getAllSessionChunks(sessionId: string, userId: string): Promise<EpisodicNode[]>;

  /**
   * Get session metadata from first episode (chunkIndex=0)
   */
  getSessionMetadata(sessionId: string, userId: string): Promise<EpisodicNode | null>;

  /**
   * Delete all episodes in a session with cascading cleanup
   */
  deleteSession(
    sessionId: string,
    userId: string
  ): Promise<{
    deleted: boolean;
    episodesDeleted: number;
    statementsDeleted: number;
    entitiesDeleted: number;
  }>;

  /**
   * Get all sessions for a user (first episode of each session)
   * Returns first episode of each session for session-level metadata
   */
  getUserSessions(params: {
    userId: string;
    type?: string;
    limit?: number;
  }): Promise<EpisodicNode[]>;

  /**
   * Get episodes by userId with optional time range filtering
   */
  getEpisodesByUserId(params: {
    userId: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<EpisodicNode[]>;

  /**
   * Link an episode to an existing statement (for duplicate handling)
   */
  linkEpisodeToStatement(episodeUuid: string, statementUuid: string, userId: string): Promise<void>;

  /**
   * Move all provenance relationships from source statement to target statement
   * Used when consolidating duplicate statements
   * @returns Number of episode relationships moved
   */
  moveProvenanceToStatement(
    sourceStatementUuid: string,
    targetStatementUuid: string,
    userId: string
  ): Promise<number>;

  /**
   * Get statements invalidated by an episode
   */
  getStatementsInvalidatedByEpisode(episodeUuid: string, userId: string): Promise<StatementNode[]>;

  /**
   * Invalidate statements from previous version
   */
  invalidateStatementsFromPreviousVersion(
    sessionId: string,
    userId: string,
    previousVersion: number,
    invalidatedBy: string,
    invalidatedAt?: Date,
    changedChunkIndices?: number[]
  ): Promise<{ invalidatedCount: number; statementUuids: string[] }>;

  /**
   * Get the first episode (chunkIndex=0) of the latest version for a session
   * This episode stores version metadata
   */
  getLatestVersionFirstEpisode(sessionId: string, userId: string): Promise<EpisodicNode | null>;

  /**
   * Update recall count for episodes
   */
  updateEpisodeRecallCount(userId: string, episodeUuids: string[]): Promise<void>;

  episodeEntityMatchCount(
    episodeIds: string[],
    entityIds: string[],
    userId: string
  ): Promise<Map<string, number>>;

  getEpisodesInvalidFacts(episodeUuids: string[], userId: string): Promise<{ episodeUuid: string; statementUuid: string; fact: string; validAt: Date; invalidAt: Date }[]>;

  // ===== STATEMENTS =====

  /**
   * Save or update a statement node
   * @returns Statement UUID
   */
  saveStatement(statement: StatementNode): Promise<string>;

  /**
   * Get statement by UUID
   */
  getStatement(uuid: string, userId: string): Promise<StatementNode | null>;

  /**
   * Delete statements by UUIDs
   */
  deleteStatements(uuids: string[], userId: string): Promise<void>;

  /**
   * Find semantically similar statements using vector similarity
   */
  findSimilarStatements(params: {
    queryEmbedding: number[];
    threshold: number;
    limit: number;
    userId: string;
    spaceIds?: string[];
  }): Promise<Array<{ statement: StatementNode; score: number }>>;

  /**
   * Find contradictory statements (same subject and predicate, different objects)
   */
  findContradictoryStatements(params: {
    subjectName: string;
    predicateName: string;
    userId: string;
  }): Promise<StatementNode[]>;

  /**
   * Invalidate a statement
   */
  invalidateStatement(
    uuid: string,
    invalidatedBy: string,
    invalidAt: Date,
    userId: string
  ): Promise<void>;

  /**
   * Get multiple statements by UUIDs in a single query
   * @param uuids - Array of statement UUIDs to fetch
   * @param userId - User ID for authorization
   * @returns Array of statement nodes
   */
  getStatements(uuids: string[], userId: string): Promise<StatementNode[]>;

  /**
   * Find statements with same subject and object but different predicates
   * Example: "John is_married_to Sarah" vs "John is_divorced_from Sarah"
   */
  findStatementsWithSameSubjectObject(params: {
    subjectId: string;
    objectId: string;
    excludePredicateId?: string;
    userId: string;
  }): Promise<StatementNode[]>;

  /**
   * Find contradictory statements (same subject and predicate, different objects)
   */
  findContradictoryStatementsBatch(params: {
    pairs: Array<{ subjectId: string; predicateId: string }>;
    userId: string;
    excludeStatementIds?: string[];
  }): Promise<Map<string, StatementNode[]>>;

  /**
   * Find statements with same subject and object but different predicates
   * Example: "John is_married_to Sarah" vs "John is_divorced_from Sarah"
   */
  findStatementsWithSameSubjectObjectBatch(params: {
    pairs: Array<{ subjectId: string; objectId: string; excludePredicateId?: string }>;
    userId: string;
    excludeStatementIds?: string[];
  }): Promise<Map<string, StatementNode[]>>;

  /**
   * Update recall count for statements
   */
  updateStatementRecallCount(userId: string, statementUuids: string[]): Promise<void>;

  /**
   * Get EpisodeIds for statements
   * @param statementUuids
   */
  getEpisodeIdsForStatements(statementUuids: string[]): Promise<Map<string, string>>;

  // ===== TRIPLES =====

  /**
   * Save a complete triple (statement + subject/predicate/object entities + provenance)
   * This is a complex operation that creates/updates multiple nodes and relationships
   * @returns Statement UUID
   */
  saveTriple(triple: {
    statement: StatementNode;
    subject: EntityNode;
    predicate: EntityNode;
    object: EntityNode;
    episodeUuid: string;
    userId: string;
  }): Promise<string>;

  /**
   * Get all triples for an episode
   */
  getTriplesForEpisode(episodeUuid: string, userId: string): Promise<Triple[]>;

  /**
   * Get triples for multiple statements (batch operation)
   */
  getTriplesForStatementsBatch(
    statementUuids: string[],
    userId: string
  ): Promise<Map<string, Triple>>;

  // ===== COMPACTED SESSIONS =====

  /**
   * Save or update a compacted session
   * @returns Compacted session UUID
   */
  saveCompactedSession(compact: CompactedSessionNode): Promise<string>;

  /**
   * Get compacted session by UUID
   */
  getCompactedSession(uuid: string, userId: string): Promise<CompactedSessionNode | null>;

  /**
   * Get compacted session by session ID
   */
  getCompactedSessionBySessionId(
    sessionId: string,
    userId: string
  ): Promise<CompactedSessionNode | null>;

  /**
   * Delete compacted session
   */
  deleteCompactedSession(uuid: string, userId: string): Promise<void>;

  /**
   * Get compaction statistics for a user
   */
  getCompactionStats(userId: string): Promise<{
    totalSessions: number;
    totalEpisodes: number;
    averageCompressionRatio: number;
  }>;

  /**
   * Link episodes to compacted session
   */
  linkEpisodesToCompact(compactUuid: string, episodeUuids: string[], userId: string): Promise<void>;

  /**
   * Get episodes for a compacted session
   */
  getEpisodesForCompact(compactUuid: string, userId: string): Promise<EpisodicNode[]>;

  /**
   * Get episodes for a session
   */
  getSessionEpisodes(sessionId: string, userId: string, afterTime?: Date): Promise<EpisodicNode[]>;

  deleteUser(userId: string): Promise<void>;

  // ===== SEARCH OPERATIONS =====

  /**
   * Get episodes for given statement UUIDs (generic, reusable)
   * Does NOT do scoring - just fetches episodes and their statements
   */
  getEpisodesForStatements(params: {
    statementUuids: string[];
    userId: string;
    validAt: Date;
    startTime?: Date;
    includeInvalidated: boolean;
    labelIds: string[];
  }): Promise<
    Array<{
      episode: EpisodicNode;
      statements: StatementNode[];
    }>
  >;

  /**
   * Get episodes by IDs with their statements (generic, reusable)
   * Does NOT do scoring - just fetches episodes and their statements
   */
  getEpisodesByIdsWithStatements(params: {
    episodeUuids: string[];
    userId: string;
    validAt: Date;
    startTime?: Date;
    includeInvalidated: boolean;
    labelIds: string[];
  }): Promise<
    Array<{
      episode: EpisodicNode;
      statements: StatementNode[];
    }>
  >;

  /**
   * Perform BM25 fulltext search on statements grouped by episodes
   */
  performBM25Search(params: {
    query: string;
    userId: string;
    validAt: Date;
    startTime?: Date;
    includeInvalidated: boolean;
    labelIds: string[];
    statementLimit: number;
  }): Promise<
    Array<{
      episode: EpisodicNode;
      score: number;
      statementCount: number;
      topStatements: StatementNode[];
    }>
  >;

  /**
   * BFS traversal - get statements connected to entities
   * NOTE: Scoring moved to vector provider, this only returns statement IDs
   */
  bfsGetStatements(params: {
    entityIds: string[];
    userId: string;
    validAt: Date;
    startTime?: Date;
    includeInvalidated: boolean;
    limit?: number;
  }): Promise<Array<{ uuid: string; relevance: number }>>;

  /**
   * BFS traversal - fetch full statements with episode IDs
   */
  bfsFetchStatements(params: { statementUuids: string[]; userId: string }): Promise<
    Array<{
      statement: StatementNode;
      episodeIds: string[];
    }>
  >;

  /**
   * BFS traversal - get connected entities for next level
   */
  bfsGetNextLevel(params: {
    statementUuids: string[];
    userId: string;
  }): Promise<Array<{ entityId: string }>>;

  /**
   * Perform episode graph search - find episodes with dense subgraphs
   */
  performEpisodeGraphSearch(params: {
    queryEntityIds: string[];
    userId: string;
    validAt: Date;
    startTime?: Date;
    includeInvalidated: boolean;
    labelIds: string[];
  }): Promise<
    Array<{
      episode: EpisodicNode;
      statements: StatementNode[];
      entityMatchedStmtIds: string[];
      entityMatchCount: number;
      totalStmtCount: number;
      connectivityScore: number;
    }>
  >;

  /**
   * Fetch episodes by IDs (used by BFS search)
   */
  fetchEpisodesByIds(params: {
    episodeIds: string[];
    userId: string;
    labelIds: string[];
  }): Promise<EpisodicNode[]>;

  getClusteredGraphData(userId: string, limit?: number): Promise<RawTriplet[]>;

  // ===== SEARCH V2 METHODS =====

  /**
   * Get episodes with statements filtered by labels, aspects, and temporal constraints
   * Used by handleAspectQuery in search-v2
   */
  getEpisodesForAspect(params: {
    userId: string;
    labelIds: string[];
    aspects: string[];
    temporalStart?: Date;
    temporalEnd?: Date;
    maxEpisodes: number;
  }): Promise<EpisodicNode[]>;

  /**
   * Get statements connected to specific entities (for entity lookup)
   * Used by handleEntityLookup in search-v2
   */
  getEpisodesForEntities(params: {
    entityUuids: string[];
    userId: string;
    maxEpisodes: number;
  }): Promise<EpisodicNode[]>;

  /**
   * Get episodes within a time range with statement filtering
   * Used by handleTemporal in search-v2
   */
  getEpisodesForTemporal(params: {
    userId: string;
    labelIds: string[];
    aspects: string[];
    startTime: Date;
    endTime?: Date;
    maxEpisodes: number;
  }): Promise<EpisodicNode[]> ;

  /**
   * Find relationship statements between two entities
   * Used by handleRelationship in search-v2
   */
  getStatementsConnectingEntities(params: {
    userId: string;
    entityHint1: string;
    entityHint2: string;
    maxStatements: number;
  }): Promise<StatementNode[]>;

  /**
   * Get episodes filtered by labels (for exploratory queries)
   * Used by handleExploratory in search-v2
   */
  getEpisodesForExploratory(params: {
    userId: string;
    labelIds: string[];
    maxEpisodes: number;
  }): Promise<EpisodicNode[]>;
}
