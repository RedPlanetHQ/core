import {
  EPISODIC_NODE_PROPERTIES,
  type EntityNode,
  type StatementNode,
  type EpisodicNode,
  type EpisodeSearchResult,
  type SearchOptions,
} from "@core/types";
import type { Embedding } from "ai";
import { logger } from "../logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { getEmbedding } from "~/lib/model.server";
import { findSimilarEntities } from "../graphModels/entity";

/**
 * Perform BM25 keyword-based search on statements
 */
export async function performBM25Search(
  query: string,
  userId: string,
  options: Required<SearchOptions>,
): Promise<EpisodeSearchResult[]> {
  try {
    // Sanitize the query for Lucene syntax
    const sanitizedQuery = sanitizeLuceneQuery(query);

    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt
        ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
        AND s.validAt >= $startTime
      `;
    }

    // Use Neo4j's built-in fulltext search capabilities with provenance count
    // Optimized: Single query to avoid expensive UNWIND + MATCH pattern
    // BM25 gets 3x limit since keyword matching is less precise than semantic search
    const STATEMENT_LIMIT = 150;

    // Build episode label filter condition (hard filter: exclude episodes with no labels)
    let episodeLabelCondition = "";
    if (options.labelIds.length > 0) {
      episodeLabelCondition = `
        AND e.labelIds IS NOT NULL
        AND size(e.labelIds) > 0
        AND ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)
      `;
    }

    // Combined query: search statements and group by episode in one pass
    // Use statement uuid for indexed lookup instead of node reference
    const cypher = `
        CALL db.index.fulltext.queryNodes("statement_fact_index", $query)
        YIELD node AS s, score
        WHERE s.userId = $userId
          AND score >= 0.5
          ${timeframeCondition}
        WITH s, score
        ORDER BY score DESC
        LIMIT ${STATEMENT_LIMIT}
        MATCH (s)<-[:HAS_PROVENANCE]-(e:Episode {userId: $userId})
        WHERE true ${episodeLabelCondition}
        WITH e,
             COLLECT(s) as statements,
             COLLECT(score) as scores
        WITH e,
             statements,
             reduce(sum = 0.0, sc IN scores | sum + sc) / size(scores) as avgScore,
             size(statements) as stmtCount
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode,
               avgScore as score,
               stmtCount,
               statements[0..5] as topStatements,
               [] as invalidatedStatements
        ORDER BY avgScore DESC
      `;

    const params = {
      query: sanitizedQuery,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.labelIds.length > 0 && { labelIds: options.labelIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const episode = record.get("episode") as EpisodicNode;
      const scoreValue = record.get("score");
      const stmtCountValue = record.get("stmtCount");
      const topStatementsRaw = record.get("topStatements") || [];

      return {
        episode,
        score:
          typeof scoreValue === "number"
            ? scoreValue
            : (scoreValue?.toNumber?.() ?? 0),
        statementCount:
          typeof stmtCountValue === "bigint"
            ? Number(stmtCountValue)
            : (stmtCountValue?.toNumber?.() ?? stmtCountValue ?? 0),
        topStatements: topStatementsRaw.map(
          (s: any) => s.properties as StatementNode,
        ),
        invalidatedStatements: [], // Will be filtered at the end in search.server.ts
      };
    });
  } catch (error) {
    logger.error("BM25 search error:", { error });
    return [];
  }
}

/**
 * Sanitize a query string for Lucene syntax
 */
export function sanitizeLuceneQuery(query: string): string {
  // Escape special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
  let sanitized = query.replace(
    /[+\-&|!(){}[\]^"~*?:\\\/]/g,
    (match) => "\\" + match,
  );

  // If query is too long, truncate it
  const MAX_QUERY_LENGTH = 32;
  const words = sanitized.split(" ");
  if (words.length > MAX_QUERY_LENGTH) {
    sanitized = words.slice(0, MAX_QUERY_LENGTH).join(" ");
  }

  return sanitized;
}

/**
 * Perform vector similarity search on statement embeddings
 */
export async function performVectorSearch(
  query: Embedding,
  userId: string,
  options: Required<SearchOptions>,
): Promise<EpisodeSearchResult[]> {
  try {
    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt
        ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
        AND s.validAt >= $startTime
      `;
    }

    // Internal statement limit (not exposed to users)
    const STATEMENT_LIMIT = 100;

    // Build episode label filter condition (hard filter: exclude episodes with no labels)
    let episodeLabelCondition = "";
    if (options.labelIds.length > 0) {
      episodeLabelCondition = `
        AND e.labelIds IS NOT NULL
        AND size(e.labelIds) > 0
        AND ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)
      `;
    }

    const cypher = `
    MATCH (s:Statement{userId: $userId})
    WHERE s.factEmbedding IS NOT NULL
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
      ${options.startTime ? "AND s.validAt >= $startTime" : ""}
    WITH s, gds.similarity.cosine(s.factEmbedding, $embedding) AS score
    WHERE score >= 0.5
    WITH s, score
    ORDER BY score DESC
    LIMIT ${STATEMENT_LIMIT}
    MATCH (s)<-[:HAS_PROVENANCE]-(e:Episode {userId: $userId})
    WHERE true ${episodeLabelCondition}
    WITH e,
         COLLECT({stmt: s, score: score}) as allStatements,
         AVG(score) as avgScore,
         COUNT(s) as stmtCount
    RETURN ${EPISODIC_NODE_PROPERTIES} as episode,
           avgScore as score,
           stmtCount,
           [item IN allStatements | item.stmt][0..5] as topStatements,
           [] as invalidatedStatements
    ORDER BY avgScore DESC
  `;

    const params = {
      embedding: query,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.labelIds.length > 0 && { labelIds: options.labelIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const episode = record.get("episode") as EpisodicNode;
      const scoreValue = record.get("score");
      const stmtCountValue = record.get("stmtCount");
      const topStatementsRaw = record.get("topStatements") || [];

      return {
        episode,
        score:
          typeof scoreValue === "number"
            ? scoreValue
            : (scoreValue?.toNumber?.() ?? 0),
        statementCount:
          typeof stmtCountValue === "bigint"
            ? Number(stmtCountValue)
            : (stmtCountValue?.toNumber?.() ?? stmtCountValue ?? 0),
        topStatements: topStatementsRaw.map(
          (s: any) => s.properties as StatementNode,
        ),
        invalidatedStatements: [], // Will be filtered at the end in search.server.ts
      };
    });
  } catch (error) {
    logger.error("Vector search error:", { error });
    return [];
  }
}

/**
 * Perform BFS traversal starting from entities mentioned in the query
 * Uses guided search with semantic filtering to reduce noise
 */
export async function performBfsSearch(
  query: string,
  embedding: Embedding,
  userId: string,
  entities: EntityNode[],
  options: Required<SearchOptions>,
): Promise<EpisodeSearchResult[]> {
  try {
    if (entities.length === 0) {
      return [];
    }

    // 2. Perform guided BFS with semantic filtering
    const { statements, hopDistanceMap } = await bfsTraversal(
      entities,
      embedding,
      options.maxBfsDepth || 3,
      options.endTime,
      userId,
      options.includeInvalidated,
      options.startTime,
    );

    if (statements.length === 0) {
      return [];
    }

    // Group by episode IN MEMORY (fastest approach!)
    // Calculate scores with hop multipliers using pre-computed BFS relevance
    const episodeStatementsMap = new Map<
      string,
      Array<{ statement: StatementNode; score: number }>
    >();

    statements.forEach((s) => {
      const episodeIds = (s as any).episodeIds || [];
      const hopDistance = hopDistanceMap.get(s.uuid) || 4;
      const hopMultiplier =
        hopDistance === 1
          ? 2.0
          : hopDistance === 2
            ? 1.3
            : hopDistance === 3
              ? 1.0
              : 0.8;

      const relevance = (s as any).bfsRelevance || 0.5;
      const score = relevance * hopMultiplier;

      episodeIds.forEach((episodeId: string) => {
        if (!episodeStatementsMap.has(episodeId)) {
          episodeStatementsMap.set(episodeId, []);
        }
        episodeStatementsMap.get(episodeId)!.push({ statement: s, score });
      });
    });

    // Fetch episodes in ONE efficient query
    const episodeIds = Array.from(episodeStatementsMap.keys());
    if (episodeIds.length === 0) {
      return [];
    }

    // Build episode label filter condition (hard filter: exclude episodes with no labels)
    let episodeLabelCondition = "";
    if (options.labelIds.length > 0) {
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

    const records = await runQuery(cypher, {
      episodeIds,
      userId,
      ...(options.labelIds.length > 0 && { labelIds: options.labelIds }),
    });

    // Build results with aggregated scores (in-memory aggregation)
    return records
      .map((record) => {
        const episode = record.get("episode") as EpisodicNode;
        const episodeData = episodeStatementsMap.get(episode.uuid)!;

        const avgScore =
          episodeData.reduce((sum, d) => sum + d.score, 0) / episodeData.length;
        const topStatements = episodeData
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((d) => d.statement);

        return {
          episode,
          score: avgScore,
          statementCount: episodeData.length,
          topStatements,
          invalidatedStatements: [], // Will be filtered at the end in search.server.ts
        };
      })
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    logger.error("BFS search error:", { error });
    return [];
  }
}

/**
 * Iterative BFS traversal - explores up to 3 hops level-by-level using Neo4j cosine similarity
 */
async function bfsTraversal(
  startEntities: EntityNode[],
  queryEmbedding: Embedding,
  maxDepth: number,
  validAt: Date,
  userId: string,
  includeInvalidated: boolean,
  startTime: Date | null,
): Promise<{
  statements: StatementNode[];
  hopDistanceMap: Map<string, number>;
}> {
  const RELEVANCE_THRESHOLD = 0.65;
  const EXPLORATION_THRESHOLD = 0.3;

  const allStatements = new Map<
    string,
    { relevance: number; hopDistance: number }
  >(); // uuid -> {relevance, hopDistance}
  const visitedEntities = new Set<string>();

  // Track entities per level for iterative BFS
  let currentLevelEntities = startEntities.map((e) => e.uuid);

  // Timeframe condition for temporal filtering
  let timeframeCondition = `
    AND s.validAt <= $validAt
    ${includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
  `;
  if (startTime) {
    timeframeCondition += ` AND s.validAt >= $startTime`;
  }

  // Process each depth level
  for (let depth = 0; depth < maxDepth; depth++) {
    if (currentLevelEntities.length === 0) break;

    // Mark entities as visited at this depth
    currentLevelEntities.forEach((id) => visitedEntities.add(`${id}`));

    // Get statements for current level entities with cosine similarity calculated in Neo4j
    // Optimized: userId in MATCH for index usage + named rel variable for relationship index
    const cypher = `
      MATCH (e:Entity{userId: $userId})-[rel:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement{userId: $userId})
      WHERE e.uuid IN $entityIds
        ${timeframeCondition}
      WITH DISTINCT s  // Deduplicate first
      WITH s, gds.similarity.cosine(s.factEmbedding, $queryEmbedding) AS relevance
      WHERE relevance >= $explorationThreshold
      RETURN s.uuid AS uuid, relevance
      ORDER BY relevance DESC
      LIMIT 200
    `;

    const records = await runQuery(cypher, {
      entityIds: currentLevelEntities,
      userId,
      queryEmbedding,
      explorationThreshold: EXPLORATION_THRESHOLD,
      validAt: validAt.toISOString(),
      ...(startTime && { startTime: startTime.toISOString() }),
    });

    // Store statement relevance scores and hop distance
    const currentLevelStatementUuids: string[] = [];
    for (const record of records) {
      const uuid = record.get("uuid");
      const relevance = record.get("relevance");

      if (!allStatements.has(uuid)) {
        allStatements.set(uuid, { relevance, hopDistance: depth + 1 }); // Store hop distance (1-indexed)
        currentLevelStatementUuids.push(uuid);
      }
    }

    // Get connected entities for next level
    // Optimized: userId in MATCH + named rel variable for relationship index
    if (depth < maxDepth - 1 && currentLevelStatementUuids.length > 0) {
      const nextCypher = `
        MATCH (s:Statement{userId: $userId})-[rel:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(e:Entity{userId: $userId})
        WHERE s.uuid IN $statementUuids
        RETURN DISTINCT e.uuid AS entityId
      `;

      const nextRecords = await runQuery(nextCypher, {
        statementUuids: currentLevelStatementUuids,
        userId,
      });

      // Filter out already visited entities
      currentLevelEntities = nextRecords
        .map((r) => r.get("entityId"))
        .filter((id) => !visitedEntities.has(`${id}`));
    } else {
      currentLevelEntities = [];
    }
  }

  // Filter by relevance threshold and fetch full statements
  const relevantResults = Array.from(allStatements.entries())
    .filter(([_, data]) => data.relevance >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b[1].relevance - a[1].relevance);

  if (relevantResults.length === 0) {
    return { statements: [], hopDistanceMap: new Map() };
  }

  const relevantUuids = relevantResults.map(([uuid]) => uuid);

  // Fetch statements WITH their episode IDs for in-memory grouping
  const fetchCypher = `
    MATCH (s:Statement{userId: $userId})
    WHERE s.uuid IN $uuids
    OPTIONAL MATCH (e:Episode)-[:HAS_PROVENANCE]->(s)
    WITH s, collect(e.uuid) as episodeIds
    RETURN s, episodeIds
  `;
  const fetchRecords = await runQuery(fetchCypher, {
    uuids: relevantUuids,
    userId,
  });
  const statementMap = new Map(
    fetchRecords.map((r) => {
      const stmt = r.get("s").properties as StatementNode;
      const episodeIds = r.get("episodeIds") || [];
      return [stmt.uuid, { statement: stmt, episodeIds }];
    }),
  );

  // Create hop distance and relevance maps for later use
  const hopDistanceMap = new Map<string, number>();
  const relevanceMap = new Map<string, number>();
  const statements = relevantResults.map(([uuid, data]) => {
    const { statement, episodeIds } = statementMap.get(uuid)!;
    hopDistanceMap.set(uuid, data.hopDistance);
    relevanceMap.set(uuid, data.relevance);
    // Attach relevance and episodeIds to statement for easy access
    (statement as any).bfsRelevance = data.relevance;
    (statement as any).episodeIds = episodeIds;
    return statement;
  });

  const hopCounts = statements.reduce(
    (acc, s) => {
      const hop = hopDistanceMap.get(s.uuid) || 0;
      acc[hop] = (acc[hop] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>,
  );

  logger.info(
    `BFS: explored ${allStatements.size} statements across ${maxDepth} hops, ` +
      `returning ${statements.length} (≥${RELEVANCE_THRESHOLD}) - ` +
      `1-hop: ${hopCounts[1] || 0}, 2-hop: ${hopCounts[2] || 0}, 3-hop: ${hopCounts[3] || 0}, 4-hop: ${hopCounts[4] || 0}`,
  );

  return { statements, hopDistanceMap };
}

/**
 * Generate query chunks (individual words and bigrams) for entity extraction
 */
function generateQueryChunks(query: string): string[] {
  const words = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  const chunks: string[] = [];

  // Add individual words (for entities like "user")
  chunks.push(...words);

  // Add bigrams (for multi-word entities like "home address")
  for (let i = 0; i < words.length - 1; i++) {
    chunks.push(`${words[i]} ${words[i + 1]}`);
  }

  // Add full query as final chunk
  chunks.push(query.toLowerCase().trim());

  return chunks;
}

/**
 * Extract potential entities from a query using chunked embeddings
 * Chunks query into words/bigrams, embeds each chunk, finds entities for each
 */
export async function extractEntitiesFromQuery(
  query: string,
  userId: string,
  startEntities: string[] = [],
): Promise<EntityNode[]> {
  try {
    let chunkEmbeddings: Embedding[] = [];
    if (startEntities.length === 0) {
      // Generate chunks from query
      const chunks = generateQueryChunks(query);
      // Get embeddings for each chunk
      chunkEmbeddings = await Promise.all(
        chunks.map((chunk) => getEmbedding(chunk)),
      );
    } else {
      chunkEmbeddings = await Promise.all(
        startEntities.map((chunk) => getEmbedding(chunk)),
      );
    }

    // Search for entities matching each chunk embedding
    const allEntitySets = await Promise.all(
      chunkEmbeddings.map(async (embedding) => {
        return await findSimilarEntities({
          queryEmbedding: embedding,
          limit: 3,
          threshold: 0.5,
          userId,
        });
      }),
    );

    // Flatten and deduplicate entities by ID
    const allEntities = allEntitySets.flat();
    const uniqueEntities = Array.from(
      new Map(allEntities.map((e) => [e.uuid, e])).values(),
    );

    return uniqueEntities;
  } catch (error) {
    logger.error("Entity extraction error:", { error });
    return [];
  }
}

/**
 * Combine and deduplicate statements from different search methods
 */
export function combineAndDeduplicateStatements(
  statements: StatementNode[],
): StatementNode[] {
  return Array.from(
    new Map(
      statements.map((statement) => [statement.uuid, statement]),
    ).values(),
  );
}

export async function getEpisodesByStatements(
  statements: StatementNode[],
): Promise<EpisodicNode[]> {
  const cypher = `
    MATCH (s:Statement)<-[:HAS_PROVENANCE]-(e:Episode)
    WHERE s.uuid IN $statementUuids
    RETURN distinct e
  `;

  const params = {
    statementUuids: statements.map((s) => s.uuid),
  };

  const records = await runQuery(cypher, params);
  return records.map((record) => record.get("e").properties as EpisodicNode);
}

/**
 * Episode Graph Search Result
 */
export interface EpisodeGraphResult {
  episode: EpisodicNode;
  statements: StatementNode[];
  score: number;
  metrics: {
    entityMatchCount: number;
    totalStatementCount: number;
    avgRelevance: number;
    connectivityScore: number;
  };
}

/**
 * Perform episode-centric graph search
 * Finds episodes with dense subgraphs of statements connected to query entities
 */
export async function performEpisodeGraphSearch(
  queryEntities: EntityNode[],
  queryEmbedding: Embedding,
  userId: string,
  options: Required<SearchOptions>,
): Promise<EpisodeGraphResult[]> {
  try {
    // If no entities extracted, return empty
    if (queryEntities.length === 0) {
      logger.info("Episode graph search: no entities extracted from query");
      return [];
    }

    const queryEntityIds = queryEntities.map((e) => e.uuid);
    logger.info(
      `Episode graph search: ${queryEntityIds.length} query entities`,
      {
        entities: queryEntities.map((e) => e.name).join(", "),
      },
    );

    // Timeframe condition for temporal filtering
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? "" : "AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)"}
    `;
    if (options.startTime) {
      timeframeCondition += ` AND s.validAt >= $startTime`;
    }

    // Build episode label filter condition (hard filter: exclude episodes with no labels)
    let episodeLabelCondition = "";
    if (options.labelIds.length > 0) {
      episodeLabelCondition = `
        AND ep.labelIds IS NOT NULL
        AND size(ep.labelIds) > 0
        AND ANY(labelId IN $labelIds WHERE labelId IN ep.labelIds)
      `;
    }

    const cypher = `
      // Step 1: Find statements connected to query entities
      // Optimized: userId in MATCH + named rel for relationship index
      MATCH (queryEntity:Entity{userId: $userId})-[rel1:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement{userId: $userId})
      WHERE queryEntity.uuid IN $queryEntityIds
        ${timeframeCondition}

      // Step 2: Find episodes containing these statements and filter by labelIds
      // Optimized: Named rel for HAS_PROVENANCE index
      MATCH (s)<-[provRel:HAS_PROVENANCE]-(ep:Episode)
      WHERE true ${episodeLabelCondition}

      // Step 3: Collect all statements from these episodes (for metrics only)
      // Optimized: userId filter + named rel for relationship index
      MATCH (ep)-[provRel2:HAS_PROVENANCE]->(epStatement:Statement{userId: $userId})
      WHERE epStatement.validAt <= $validAt
        AND (epStatement.invalidAt IS NULL OR epStatement.invalidAt > $validAt)

      // Step 4: Calculate episode-level metrics
      WITH ep,
           collect(DISTINCT s) as entityMatchedStatements,
           collect(DISTINCT epStatement) as allEpisodeStatements,
           collect(DISTINCT queryEntity) as matchedEntities

      // Step 5: Calculate all metrics in one pass (optimized: fewer WITH clauses)
      // Direct reduce without intermediate array creation
      // IMPORTANT: avgRelevance now computed from entityMatchedStatements ONLY (not all statements)
      // This prevents irrelevant statements from diluting the relevance score
      WITH ep,
           entityMatchedStatements,
           size(matchedEntities) as entityMatchCount,
           size(entityMatchedStatements) as entityStmtCount,
           size(allEpisodeStatements) as totalStmtCount,
           reduce(sum = 0.0, stmt IN entityMatchedStatements |
             sum + gds.similarity.cosine(stmt.factEmbedding, $queryEmbedding)
           ) / CASE WHEN size(entityMatchedStatements) = 0 THEN 1 ELSE size(entityMatchedStatements) END as avgRelevance

      // Step 6: Calculate connectivity and filter
      WITH ep,
           entityMatchedStatements,
           entityMatchCount,
           entityStmtCount,
           totalStmtCount,
           avgRelevance,
           (toFloat(entityStmtCount) / CASE WHEN totalStmtCount = 0 THEN 1 ELSE totalStmtCount END) *
             entityMatchCount as connectivityScore
      WHERE entityMatchCount >= 1
        AND avgRelevance >= 0.5
        AND totalStmtCount >= 1

      // Step 7: Calculate final score and return
      RETURN ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "ep.")} as episode,
             entityMatchedStatements as statements,
             entityMatchCount,
             totalStmtCount,
             avgRelevance,
             connectivityScore,
             (entityMatchCount * 2.0) + connectivityScore + avgRelevance as episodeScore

      ORDER BY episodeScore DESC, entityMatchCount DESC, totalStmtCount DESC
      LIMIT 50
    `;

    const params = {
      queryEntityIds,
      userId,
      queryEmbedding,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.labelIds.length > 0 && { labelIds: options.labelIds }),
    };

    const records = await runQuery(cypher, params);

    const results: EpisodeGraphResult[] = records.map((record) => {
      const episode = record.get("episode") as EpisodicNode;
      const statements = record
        .get("statements")
        .map((s: any) => s.properties as StatementNode);
      const entityMatchCount =
        typeof record.get("entityMatchCount") === "bigint"
          ? Number(record.get("entityMatchCount"))
          : record.get("entityMatchCount");
      const totalStmtCount =
        typeof record.get("totalStmtCount") === "bigint"
          ? Number(record.get("totalStmtCount"))
          : record.get("totalStmtCount");
      const avgRelevance = record.get("avgRelevance");
      const connectivityScore = record.get("connectivityScore");
      const episodeScore = record.get("episodeScore");

      return {
        episode,
        statements,
        score: episodeScore,
        metrics: {
          entityMatchCount,
          totalStatementCount: totalStmtCount,
          avgRelevance,
          connectivityScore,
        },
      };
    });

    logger.info(
      `Episode graph search: found ${results.length} episodes, ` +
        `top score: ${results[0]?.score.toFixed(2) || "N/A"}` +
        (results.length > 0
          ? `, top episode: ${results[0].metrics.entityMatchCount} entities, ` +
            `${results[0].statements.length} matched stmts, ` +
            `avgRelevance: ${results[0].metrics.avgRelevance.toFixed(3)}`
          : ""),
    );

    return results;
  } catch (error) {
    logger.error("Episode graph search error:", { error });
    return [];
  }
}

/**
 * Get episode IDs for statements in batch (efficient, no N+1 queries)
 */
export async function getEpisodeIdsForStatements(
  statementUuids: string[],
): Promise<Map<string, string>> {
  if (statementUuids.length === 0) {
    return new Map();
  }

  // Optimized: Named rel for HAS_PROVENANCE relationship index
  const cypher = `
    MATCH (s:Statement)<-[provRel:HAS_PROVENANCE]-(e:Episode)
    WHERE s.uuid IN $statementUuids
    RETURN s.uuid as statementUuid, e.uuid as episodeUuid
  `;

  const records = await runQuery(cypher, { statementUuids });

  const map = new Map<string, string>();
  records.forEach((record) => {
    map.set(record.get("statementUuid"), record.get("episodeUuid"));
  });

  return map;
}

/**
 * Group statements by their episode IDs using pre-fetched episodeIds (IN-MEMORY, NO Neo4j query!)
 * This is 15,000x faster than the old approach that queried Neo4j
 */
export function groupStatementsByEpisodeInMemory(
  statements: StatementNode[],
): Map<string, StatementNode[]> {
  const grouped = new Map<string, StatementNode[]>();

  if (statements.length === 0) {
    return grouped;
  }

  // Group statements by their pre-fetched episodeIds (from search queries)
  statements.forEach((statement) => {
    const episodeIds = (statement as any).episodeIds || [];

    // Add statement to ALL its episodes (handles multi-episode statements correctly)
    episodeIds.forEach((episodeId: string) => {
      if (!grouped.has(episodeId)) {
        grouped.set(episodeId, []);
      }
      grouped.get(episodeId)!.push(statement);
    });
  });

  return grouped;
}

/**
 * OLD: Group statements by their episode IDs efficiently (DEPRECATED - uses slow Neo4j query)
 * Use groupStatementsByEpisodeInMemory instead for 15,000x speedup
 */
export async function groupStatementsByEpisode(
  statements: StatementNode[],
): Promise<Map<string, StatementNode[]>> {
  const grouped = new Map<string, StatementNode[]>();

  if (statements.length === 0) {
    return grouped;
  }

  // Batch fetch episode IDs for all statements
  const episodeIdMap = await getEpisodeIdsForStatements(
    statements.map((s) => s.uuid),
  );

  // Group statements by episode ID
  statements.forEach((statement) => {
    const episodeId = episodeIdMap.get(statement.uuid);
    if (episodeId) {
      if (!grouped.has(episodeId)) {
        grouped.set(episodeId, []);
      }
      grouped.get(episodeId)!.push(statement);
    }
  });

  return grouped;
}

/**
 * Fetch episode objects by their UUIDs in batch
 */
export async function getEpisodesByUuids(
  episodeUuids: string[],
): Promise<Map<string, EpisodicNode>> {
  if (episodeUuids.length === 0) {
    return new Map();
  }

  const cypher = `
    MATCH (e:Episode)
    WHERE e.uuid IN $episodeUuids
    RETURN e
  `;

  const records = await runQuery(cypher, { episodeUuids });

  const map = new Map<string, EpisodicNode>();
  records.forEach((record) => {
    const episode = record.get("e").properties as EpisodicNode;
    map.set(episode.uuid, episode);
  });

  return map;
}
