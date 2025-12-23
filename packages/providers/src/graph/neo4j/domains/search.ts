/**
 * Search domain methods for Neo4j graph operations
 *
 * Handles BM25 fulltext search, vector similarity search, BFS traversal,
 * and episode graph search operations.
 */

import type { EpisodicNode, StatementNode, EntityNode } from "@core/types";
import { parseEpisodicNode, parseStatementNode, parseEntityNode } from "../parsers";
import type { Neo4jCore } from "../core";
import { EPISODIC_NODE_PROPERTIES, STATEMENT_NODE_PROPERTIES } from "../types";

export interface BM25SearchParams {
  query: string;
  userId: string;
  validAt: Date;
  startTime?: Date;
  includeInvalidated: boolean;
  labelIds: string[];
  statementLimit: number;
}

export interface BM25SearchResult {
  episode: EpisodicNode;
  score: number;
  statementCount: number;
  topStatements: StatementNode[];
}

export interface GetEpisodesForStatementsParams {
  statementUuids: string[];
  userId: string;
  validAt: Date;
  startTime?: Date;
  includeInvalidated: boolean;
  labelIds: string[];
}

export interface GetEpisodesForStatementsResult {
  episode: EpisodicNode;
  statements: StatementNode[];
}

export interface GetEpisodesByIdsWithStatementsParams {
  episodeUuids: string[];
  userId: string;
  validAt: Date;
  startTime?: Date;
  includeInvalidated: boolean;
  labelIds: string[];
}

export interface GetEpisodesByIdsWithStatementsResult {
  episode: EpisodicNode;
  statements: StatementNode[];
}

export interface BfsTraversalParams {
  entityIds: string[];
  userId: string;
  validAt: Date;
  startTime?: Date;
  includeInvalidated: boolean;
  limit?: number;
}

export interface BfsTraversalResult {
  uuid: string;
  relevance: number;
}

export interface BfsFetchStatementsParams {
  statementUuids: string[];
  userId: string;
}

export interface BfsFetchStatementsResult {
  statement: StatementNode;
  episodeIds: string[];
}

export interface BfsNextLevelParams {
  statementUuids: string[];
  userId: string;
}

export interface BfsNextLevelResult {
  entityId: string;
}

export interface EpisodeGraphSearchParams {
  queryEntityIds: string[];
  userId: string;
  validAt: Date;
  startTime?: Date;
  includeInvalidated: boolean;
  labelIds: string[];
}

export interface EpisodeGraphSearchResult {
  episode: EpisodicNode;
  statements: StatementNode[];
  entityMatchedStmtIds: string[];
  entityMatchCount: number;
  totalStmtCount: number;
  connectivityScore: number;
}

export interface FetchEpisodesByIdsParams {
  episodeIds: string[];
  userId: string;
  labelIds: string[];
}

/**
 * Create search domain methods
 *
 * @param core - Neo4j core instance with query execution capability
 * @returns Object containing all search-related database operations
 */
export function createSearchMethods(core: Neo4jCore) {
  return {
    /**
     * Perform BM25 fulltext search on statements grouped by episodes
     *
     * @param params - Search parameters
     * @returns Array of episodes with scores and matched statements
     */
    async performBM25Search(params: BM25SearchParams): Promise<BM25SearchResult[]> {
      // Build timeframe condition
      let timeframeCondition = `
        AND s.validAt <= $validAt
        ${params.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
      `;

      if (params.startTime) {
        timeframeCondition += ` AND s.validAt >= $startTime`;
      }

      // Build episode label filter condition
      let episodeLabelCondition = "";
      if (params.labelIds.length > 0) {
        episodeLabelCondition = `
          AND e.labelIds IS NOT NULL
          AND size(e.labelIds) > 0
          AND ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)
        `;
      }

      const cypher = `
        // BM25 fulltext search on statements
        CALL db.index.fulltext.queryNodes("statement_fact_index", $query)
        YIELD node AS s, score
        WHERE s.userId = $userId
          AND score >= 0.5
          ${timeframeCondition}
        WITH s, score
        ORDER BY score DESC
        LIMIT ${params.statementLimit}

        // Find episodes containing these statements
        MATCH (s)<-[:HAS_PROVENANCE]-(e:Episode {userId: $userId})
        ${episodeLabelCondition ? "WHERE " + episodeLabelCondition.replace("AND ", "") : ""}

        // Aggregate scores per episode
        WITH e,
             COLLECT(DISTINCT s) as statements,
             COLLECT(score) as scores
        WITH e,
             statements,
             reduce(sum = 0.0, sc IN scores | sum + sc) / size(scores) as avgScore,
             size(statements) as stmtCount
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode,
               avgScore as score,
               stmtCount,
               statements[0..5] as topStatements
        ORDER BY avgScore DESC
      `;

      const cypherParams = {
        query: params.query,
        userId: params.userId,
        validAt: params.validAt.toISOString(),
        ...(params.startTime && { startTime: params.startTime.toISOString() }),
        ...(params.labelIds.length > 0 && { labelIds: params.labelIds }),
      };

      const records = await core.runQuery(cypher, cypherParams);

      return records.map((record) => ({
        episode: parseEpisodicNode(record.get("episode")),
        score:
          typeof record.get("score") === "number"
            ? record.get("score")
            : (record.get("score")?.toNumber?.() ?? 0),
        statementCount:
          typeof record.get("stmtCount") === "bigint"
            ? Number(record.get("stmtCount"))
            : (record.get("stmtCount")?.toNumber?.() ?? record.get("stmtCount") ?? 0),
        topStatements: (record.get("topStatements") || []).map((s: any) =>
          parseStatementNode(s.properties)
        ),
      }));
    },

    /**
     * Get episodes for given statement UUIDs (generic, reusable method)
     * Does NOT do scoring - just fetches episodes and their statements
     *
     * @param params - Statement UUIDs and filters
     * @returns Array of episodes with their statements
     */
    async getEpisodesForStatements(
      params: GetEpisodesForStatementsParams
    ): Promise<GetEpisodesForStatementsResult[]> {
      // Build timeframe condition
      let timeframeCondition = `
        AND s.validAt <= $validAt
        ${params.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
      `;

      if (params.startTime) {
        timeframeCondition += ` AND s.validAt >= $startTime`;
      }

      // Build episode label filter condition
      let episodeLabelCondition = "";
      if (params.labelIds.length > 0) {
        episodeLabelCondition = `
          AND e.labelIds IS NOT NULL
          AND size(e.labelIds) > 0
          AND ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)
        `;
      }

      const cypher = `
        // Use IN for efficient index lookup of statements
        MATCH (s:Statement {userId: $userId})
        WHERE s.uuid IN $statementUuids
          ${timeframeCondition}

        // Find episodes containing these statements
        MATCH (s)<-[:HAS_PROVENANCE]-(e:Episode {userId: $userId})
        ${episodeLabelCondition ? "WHERE " + episodeLabelCondition.replace("AND ", "") : ""}

        // Group by episode with distinct statements
        WITH e, COLLECT(DISTINCT ${STATEMENT_NODE_PROPERTIES}) as statements
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode, statements
      `;

      const cypherParams = {
        userId: params.userId,
        statementUuids: params.statementUuids,
        validAt: params.validAt.toISOString(),
        ...(params.startTime && { startTime: params.startTime.toISOString() }),
        ...(params.labelIds.length > 0 && { labelIds: params.labelIds }),
      };

      const records = await core.runQuery(cypher, cypherParams);

      return records.map((record) => ({
        episode: parseEpisodicNode(record.get("episode")),
        statements: (record.get("statements") || []).map((s: any) =>
          parseStatementNode(s.properties)
        ),
      }));
    },

    /**
     * Get episodes by IDs with their statements (generic, reusable method)
     * Does NOT do scoring - just fetches episodes and their statements
     *
     * @param params - Episode UUIDs and filters
     * @returns Array of episodes with their statements
     */
    async getEpisodesByIdsWithStatements(
      params: GetEpisodesByIdsWithStatementsParams
    ): Promise<GetEpisodesByIdsWithStatementsResult[]> {
      // Build episode label filter condition
      let episodeLabelCondition = "";
      if (params.labelIds.length > 0) {
        episodeLabelCondition = `
          AND ep.labelIds IS NOT NULL
          AND size(ep.labelIds) > 0
          AND ANY(labelId IN $labelIds WHERE labelId IN ep.labelIds)
        `;
      }

      // Build timeframe condition for episodes
      let episodeTimeframeCondition = `
        AND ep.validAt <= $validAt
      `;
      if (params.startTime) {
        episodeTimeframeCondition += ` AND ep.validAt >= $startTime`;
      }

      const cypher = `
        MATCH (ep:Episode {userId: $userId})
        WHERE ep.uuid IN $episodeUuids
          ${episodeTimeframeCondition} ${episodeLabelCondition}

        // Get statements from matching episodes
        MATCH (ep)-[:HAS_PROVENANCE]->(s:Statement {userId: $userId})
        WHERE s.validAt <= $validAt
          ${params.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}

        WITH ep, COLLECT(s) as statements

        RETURN ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "ep.")} as episode,
               statements
      `;

      const cypherParams = {
        userId: params.userId,
        episodeUuids: params.episodeUuids,
        validAt: params.validAt.toISOString(),
        ...(params.startTime && { startTime: params.startTime.toISOString() }),
        ...(params.labelIds.length > 0 && { labelIds: params.labelIds }),
      };

      const records = await core.runQuery(cypher, cypherParams);

      return records.map((record) => ({
        episode: parseEpisodicNode(record.get("episode")),
        statements: (record.get("statements") || []).map((s: any) =>
          parseStatementNode(s.properties)
        ),
      }));
    },

    /**
     * BFS traversal - get statements connected to entities
     * NOTE: Scoring moved to vector provider for better performance
     *
     * @param params - Traversal parameters
     * @returns Array of statement UUIDs (scoring done separately by vector provider)
     */
    async bfsGetStatements(params: BfsTraversalParams): Promise<BfsTraversalResult[]> {
      let timeframeCondition = `
        AND s.validAt <= $validAt
        ${params.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
      `;
      if (params.startTime) {
        timeframeCondition += ` AND s.validAt >= $startTime`;
      }

      // Just fetch statements connected to entities (no scoring in Neo4j)
      // Scoring will be done by vector provider using batchScore
      const cypher = `
        UNWIND $entityIds AS entityId
        MATCH (e:Entity{userId: $userId, uuid: entityId})-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement{userId: $userId})
        WHERE true
          ${timeframeCondition}
        WITH DISTINCT s
        RETURN s.uuid AS uuid
        ORDER BY s.createdAt DESC
        LIMIT ${params.limit || 200}
      `;

      const cypherParams = {
        entityIds: params.entityIds,
        userId: params.userId,
        validAt: params.validAt.toISOString(),
        ...(params.startTime && { startTime: params.startTime.toISOString() }),
      };

      const records = await core.runQuery(cypher, cypherParams);
      // Return with placeholder relevance (will be scored by vector provider)
      return records.map((r) => ({
        uuid: r.get("uuid"),
        relevance: 0, // Placeholder, will be replaced by vector provider scoring
      }));
    },

    /**
     * BFS traversal - fetch full statements with episode IDs
     *
     * @param params - Fetch parameters
     * @returns Array of statements with their episode IDs
     */
    async bfsFetchStatements(
      params: BfsFetchStatementsParams
    ): Promise<BfsFetchStatementsResult[]> {
      const cypher = `
        MATCH (s:Statement{userId: $userId})
        WHERE s.uuid IN $uuids
        OPTIONAL MATCH (e:Episode)-[:HAS_PROVENANCE]->(s)
        WITH s, collect(e.uuid) as episodeIds
        RETURN s, episodeIds
      `;

      const records = await core.runQuery(cypher, {
        uuids: params.statementUuids,
        userId: params.userId,
      });

      return records.map((r) => ({
        statement: parseStatementNode(r.get("s").properties),
        episodeIds: r.get("episodeIds") || [],
      }));
    },

    /**
     * BFS traversal - get connected entities for next level
     *
     * @param params - Next level parameters
     * @returns Array of entity IDs
     */
    async bfsGetNextLevel(params: BfsNextLevelParams): Promise<BfsNextLevelResult[]> {
      const cypher = `
        MATCH (s:Statement{userId: $userId})-[rel:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(e:Entity{userId: $userId})
        WHERE s.uuid IN $statementUuids
        RETURN DISTINCT e.uuid AS entityId
      `;

      const records = await core.runQuery(cypher, {
        statementUuids: params.statementUuids,
        userId: params.userId,
      });

      return records.map((r) => ({ entityId: r.get("entityId") }));
    },

    /**
     * Perform episode graph search - find episodes with dense subgraphs
     *
     * @param params - Search parameters
     * @returns Array of episodes with matched statements and metrics
     */
    async performEpisodeGraphSearch(
      params: EpisodeGraphSearchParams
    ): Promise<EpisodeGraphSearchResult[]> {
      // Build timeframe condition
      let timeframeCondition = `
        AND s.validAt <= $validAt
        ${params.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
      `;
      if (params.startTime) {
        timeframeCondition += ` AND s.validAt >= $startTime`;
      }

      // Build episode label filter condition
      let episodeLabelCondition = "";
      if (params.labelIds.length > 0) {
        episodeLabelCondition = `
          AND ep.labelIds IS NOT NULL
          AND size(ep.labelIds) > 0
          AND ANY(labelId IN $labelIds WHERE labelId IN ep.labelIds)
        `;
      }

      const cypher = `
        // Find statements connected to query entities (deduplicate early)
        MATCH (queryEntity:Entity{userId: $userId})-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement{userId: $userId})
        WHERE queryEntity.uuid IN $queryEntityIds
          ${timeframeCondition}
        WITH DISTINCT s, queryEntity

        // Find episodes containing these statements
        MATCH (s)<-[:HAS_PROVENANCE]-(ep:Episode)
        WHERE true ${episodeLabelCondition}

        // Get total statement count efficiently (count instead of collecting all)
        OPTIONAL MATCH (ep)-[:HAS_PROVENANCE]->(allStmt:Statement{userId: $userId})
        WHERE allStmt.validAt <= $validAt
          ${params.includeInvalidated ? "" : "AND (allStmt.invalidAt IS NULL OR allStmt.invalidAt > $validAt)"}

        // Calculate episode-level data with optimized aggregations
        WITH ep,
             collect(DISTINCT s) as entityMatchedStatements,
             collect(DISTINCT s.uuid) as entityMatchedStmtIds,
             collect(DISTINCT queryEntity) as matchedEntities,
             count(DISTINCT allStmt) as totalStmtCount

        // Pre-calculate sizes to avoid redundant size() calls
        WITH ep,
             entityMatchedStmtIds,
             entityMatchedStatements,
             size(matchedEntities) as entityMatchCount,
             size(entityMatchedStmtIds) as entityStmtCount,
             totalStmtCount,
             toFloat(size(entityMatchedStmtIds)) / CASE WHEN totalStmtCount = 0 THEN 1 ELSE toFloat(totalStmtCount) END * size(matchedEntities) as connectivityScore
        WHERE entityMatchCount >= 1
          AND totalStmtCount >= 1

        RETURN ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "ep.")} as episode,
               entityMatchedStatements as statements,
               entityMatchedStmtIds,
               entityMatchCount,
               totalStmtCount,
               connectivityScore

        ORDER BY entityMatchCount DESC, totalStmtCount DESC
        LIMIT 100
      `;

      const cypherParams = {
        queryEntityIds: params.queryEntityIds,
        userId: params.userId,
        validAt: params.validAt.toISOString(),
        ...(params.startTime && { startTime: params.startTime.toISOString() }),
        ...(params.labelIds.length > 0 && { labelIds: params.labelIds }),
      };

      const records = await core.runQuery(cypher, cypherParams);

      return records.map((record) => {
        const rawEntityMatchCount = record.get("entityMatchCount");
        const rawTotalStmtCount = record.get("totalStmtCount");
        const rawConnectivityScore = record.get("connectivityScore");

        return {
          episode: parseEpisodicNode(record.get("episode")),
          statements: record.get("statements").map((s: any) => parseStatementNode(s.properties)),
          entityMatchedStmtIds: record.get("entityMatchedStmtIds") as string[],
          entityMatchCount: Number(rawEntityMatchCount),
          totalStmtCount: Number(rawTotalStmtCount),
          connectivityScore: Number(rawConnectivityScore),
        };
      });
    },

    /**
     * Fetch episodes by IDs (used by BFS search)
     *
     * @param params - Fetch parameters
     * @returns Array of episodes
     */
    async fetchEpisodesByIds(params: FetchEpisodesByIdsParams): Promise<EpisodicNode[]> {
      // Build episode label filter condition
      let episodeLabelCondition = "";
      if (params.labelIds.length > 0) {
        episodeLabelCondition = `
          AND e.labelIds IS NOT NULL
          AND size(e.labelIds) > 0
          AND ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)
        `;
      }

      const cypher = `
        MATCH (e:Episode{userId: $userId})
        WHERE e.uuid IN $episodeIds
          ${episodeLabelCondition}
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
      `;

      const records = await core.runQuery(cypher, {
        episodeIds: params.episodeIds,
        userId: params.userId,
        ...(params.labelIds.length > 0 && { labelIds: params.labelIds }),
      });

      return records.map((record) => parseEpisodicNode(record.get("episode")));
    },
  };
}
