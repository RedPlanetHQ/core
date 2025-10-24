import type { EntityNode, StatementNode, EpisodicNode } from "@core/types";
import type { SearchOptions } from "../search.server";
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
): Promise<StatementNode[]> {
  try {
    // Sanitize the query for Lucene syntax
    const sanitizedQuery = sanitizeLuceneQuery(query);

    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt
        ${options.includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
        AND s.validAt >= $startTime
      `;
    }

    // Add space filtering if spaceIds are provided
    let spaceCondition = "";
    if (options.spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    // Use Neo4j's built-in fulltext search capabilities with provenance count
    const cypher = `
        CALL db.index.fulltext.queryNodes("statement_fact_index", $query) 
        YIELD node AS s, score
        WHERE 
          (s.userId = $userId)
          ${timeframeCondition}
          ${spaceCondition}
        OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(s)
        WITH s, score, count(episode) as provenanceCount
        WHERE score >= 0.5
        RETURN s, score, provenanceCount
        ORDER BY score DESC
      `;

    const params = {
      query: sanitizedQuery,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.spaceIds.length > 0 && { spaceIds: options.spaceIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const statement = record.get("s").properties as StatementNode;
      const provenanceCountValue = record.get("provenanceCount");
      statement.provenanceCount =
        typeof provenanceCountValue === "bigint"
          ? Number(provenanceCountValue)
          : (provenanceCountValue?.toNumber?.() ?? provenanceCountValue ?? 0);

      const scoreValue = record.get("score");
      (statement as any).bm25Score =
        typeof scoreValue === "number"
          ? scoreValue
          : (scoreValue?.toNumber?.() ?? 0);
      return statement;
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
): Promise<StatementNode[]> {
  try {
    // Build the WHERE clause based on timeframe options
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
    `;

    // If startTime is provided, add condition to filter by validAt >= startTime
    if (options.startTime) {
      timeframeCondition = `
        AND s.validAt <= $validAt
        ${options.includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
        AND s.validAt >= $startTime
      `;
    }

    // Add space filtering if spaceIds are provided
    let spaceCondition = "";
    if (options.spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    const limit = options.limit || 100;
    // 1. Search for similar statements using GDS cosine similarity with provenance count
    const cypher = `
    MATCH (s:Statement)
    WHERE s.userId = $userId
    ${timeframeCondition}
    ${spaceCondition}
    WITH s, gds.similarity.cosine(s.factEmbedding, $embedding) AS score
    WHERE score >= 0.5
    OPTIONAL MATCH (episode:Episode)-[:HAS_PROVENANCE]->(s)
    WITH s, score, count(episode) as provenanceCount
    RETURN s, score, provenanceCount
    ORDER BY score DESC
    LIMIT ${limit}
  `;

    const params = {
      embedding: query,
      userId,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.spaceIds.length > 0 && { spaceIds: options.spaceIds }),
    };

    const records = await runQuery(cypher, params);
    return records.map((record) => {
      const statement = record.get("s").properties as StatementNode;
      const provenanceCountValue = record.get("provenanceCount");
      statement.provenanceCount =
        typeof provenanceCountValue === "bigint"
          ? Number(provenanceCountValue)
          : (provenanceCountValue?.toNumber?.() ?? provenanceCountValue ?? 0);

      // Preserve vector similarity score for empty result detection
      const scoreValue = record.get("score");
      (statement as any).vectorScore =
        typeof scoreValue === "number"
          ? scoreValue
          : (scoreValue?.toNumber?.() ?? 0);

      return statement;
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
): Promise<StatementNode[]> {
  try {
    if (entities.length === 0) {
      return [];
    }

    // 2. Perform guided BFS with semantic filtering
    const statements = await bfsTraversal(
      entities,
      embedding,
      options.maxBfsDepth || 3,
      options.endTime,
      userId,
      options.includeInvalidated,
      options.startTime,
    );

    // Return individual statements
    return statements;
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
): Promise<StatementNode[]> {
  const RELEVANCE_THRESHOLD = 0.5;
  const EXPLORATION_THRESHOLD = 0.3;

  const allStatements = new Map<string, { relevance: number; hopDistance: number }>(); // uuid -> {relevance, hopDistance}
  const visitedEntities = new Set<string>();

  // Track entities per level for iterative BFS
  let currentLevelEntities = startEntities.map(e => e.uuid);

  // Timeframe condition for temporal filtering
  let timeframeCondition = `
    AND s.validAt <= $validAt
    ${includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
  `;
  if (startTime) {
    timeframeCondition += ` AND s.validAt >= $startTime`;
  }

  // Process each depth level
  for (let depth = 0; depth < maxDepth; depth++) {
    if (currentLevelEntities.length === 0) break;

    // Mark entities as visited at this depth
    currentLevelEntities.forEach(id => visitedEntities.add(`${id}`));

    // Get statements for current level entities with cosine similarity calculated in Neo4j
    const cypher = `
      MATCH (e:Entity{userId: $userId})-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement{userId: $userId})
      WHERE e.uuid IN $entityIds
        ${timeframeCondition}
      WITH DISTINCT s  // Deduplicate first
      WITH s, gds.similarity.cosine(s.factEmbedding, $queryEmbedding) AS relevance
      WHERE relevance >= $explorationThreshold
      RETURN s.uuid AS uuid, relevance
      ORDER BY relevance DESC
      LIMIT 200  // Cap per BFS level to avoid explosion
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
    if (depth < maxDepth - 1 && currentLevelStatementUuids.length > 0) {
      const nextCypher = `
        MATCH (s:Statement{userId: $userId})-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(e:Entity{userId: $userId})
        WHERE s.uuid IN $statementUuids
        RETURN DISTINCT e.uuid AS entityId
      `;

      const nextRecords = await runQuery(nextCypher, {
        statementUuids: currentLevelStatementUuids,
        userId
      });

      // Filter out already visited entities
      currentLevelEntities = nextRecords
        .map(r => r.get("entityId"))
        .filter(id => !visitedEntities.has(`${id}`));

    } else {
      currentLevelEntities = [];
    }
  }

  // Filter by relevance threshold and fetch full statements
  const relevantResults = Array.from(allStatements.entries())
    .filter(([_, data]) => data.relevance >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b[1].relevance - a[1].relevance);

  if (relevantResults.length === 0) {
    return [];
  }

  const relevantUuids = relevantResults.map(([uuid]) => uuid);

  const fetchCypher = `
    MATCH (s:Statement{userId: $userId})
    WHERE s.uuid IN $uuids
    RETURN s
  `;
  const fetchRecords = await runQuery(fetchCypher, { uuids: relevantUuids, userId });
  const statementMap = new Map(
    fetchRecords.map(r => [r.get("s").properties.uuid, r.get("s").properties as StatementNode])
  );

  // Attach hop distance to statements
  const statements = relevantResults.map(([uuid, data]) => {
    const statement = statementMap.get(uuid)!;
    // Add bfsHopDistance and bfsRelevance as metadata
    (statement as any).bfsHopDistance = data.hopDistance;
    (statement as any).bfsRelevance = data.relevance;
    return statement;
  });

  const hopCounts = statements.reduce((acc, s) => {
    const hop = (s as any).bfsHopDistance;
    acc[hop] = (acc[hop] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  logger.info(
    `BFS: explored ${allStatements.size} statements across ${maxDepth} hops, ` +
    `returning ${statements.length} (≥${RELEVANCE_THRESHOLD}) - ` +
    `1-hop: ${hopCounts[1] || 0}, 2-hop: ${hopCounts[2] || 0}, 3-hop: ${hopCounts[3] || 0}, 4-hop: ${hopCounts[4] || 0}`
  );

  return statements;
}


/**
 * Generate query chunks (individual words and bigrams) for entity extraction
 */
function generateQueryChunks(query: string): string[] {
  const words = query.toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0);

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
        chunks.map(chunk => getEmbedding(chunk))
      );
    } else {
      chunkEmbeddings = await Promise.all(
        startEntities.map(chunk => getEmbedding(chunk))
      );
    }

    // Search for entities matching each chunk embedding
    const allEntitySets = await Promise.all(
      chunkEmbeddings.map(async (embedding) => {
        return await findSimilarEntities({
          queryEmbedding: embedding,
          limit: 3,
          threshold: 0.7,
          userId,
        });
      })
    );

    // Flatten and deduplicate entities by ID
    const allEntities = allEntitySets.flat();
    const uniqueEntities = Array.from(
      new Map(allEntities.map(e => [e.uuid, e])).values()
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
  query: string,
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

    const queryEntityIds = queryEntities.map(e => e.uuid);
    logger.info(`Episode graph search: ${queryEntityIds.length} query entities`, {
      entities: queryEntities.map(e => e.name).join(', ')
    });

    // Timeframe condition for temporal filtering
    let timeframeCondition = `
      AND s.validAt <= $validAt
      ${options.includeInvalidated ? '' : 'AND (s.invalidAt IS NULL OR s.invalidAt > $validAt)'}
    `;
    if (options.startTime) {
      timeframeCondition += ` AND s.validAt >= $startTime`;
    }

    // Space filtering if provided
    let spaceCondition = "";
    if (options.spaceIds.length > 0) {
      spaceCondition = `
        AND s.spaceIds IS NOT NULL AND ANY(spaceId IN $spaceIds WHERE spaceId IN s.spaceIds)
      `;
    }

    const cypher = `
      // Step 1: Find statements connected to query entities
      MATCH (queryEntity:Entity)-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(s:Statement)
      WHERE queryEntity.uuid IN $queryEntityIds
        AND queryEntity.userId = $userId
        AND s.userId = $userId
        ${timeframeCondition}
        ${spaceCondition}

      // Step 2: Find episodes containing these statements
      MATCH (s)<-[:HAS_PROVENANCE]-(ep:Episode)

      // Step 3: Collect all statements from these episodes (for metrics only)
      MATCH (ep)-[:HAS_PROVENANCE]->(epStatement:Statement)
      WHERE epStatement.validAt <= $validAt
        AND (epStatement.invalidAt IS NULL OR epStatement.invalidAt > $validAt)
        ${spaceCondition.replace(/s\./g, 'epStatement.')}

      // Step 4: Calculate episode-level metrics
      WITH ep,
           collect(DISTINCT s) as entityMatchedStatements,
           collect(DISTINCT epStatement) as allEpisodeStatements,
           collect(DISTINCT queryEntity) as matchedEntities

      // Step 5: Calculate semantic relevance for all episode statements
      WITH ep,
           entityMatchedStatements,
           allEpisodeStatements,
           matchedEntities,
           [stmt IN allEpisodeStatements |
             gds.similarity.cosine(stmt.factEmbedding, $queryEmbedding)
           ] as statementRelevances

      // Step 6: Calculate aggregate scores
      WITH ep,
           entityMatchedStatements,
           size(matchedEntities) as entityMatchCount,
           size(entityMatchedStatements) as entityStmtCount,
           size(allEpisodeStatements) as totalStmtCount,
           reduce(sum = 0.0, score IN statementRelevances | sum + score) /
             CASE WHEN size(statementRelevances) = 0 THEN 1 ELSE size(statementRelevances) END as avgRelevance

      // Step 7: Calculate connectivity score
      WITH ep,
           entityMatchedStatements,
           entityMatchCount,
           entityStmtCount,
           totalStmtCount,
           avgRelevance,
           (toFloat(entityStmtCount) / CASE WHEN totalStmtCount = 0 THEN 1 ELSE totalStmtCount END) *
             entityMatchCount as connectivityScore

      // Step 8: Filter for quality episodes
      WHERE entityMatchCount >= 1
        AND avgRelevance >= 0.5
        AND totalStmtCount >= 1

      // Step 9: Calculate final episode score
      WITH ep,
           entityMatchedStatements,
           entityMatchCount,
           totalStmtCount,
           avgRelevance,
           connectivityScore,
           // Prioritize: entity matches (2.0x) + connectivity + semantic relevance
           (entityMatchCount * 2.0) + connectivityScore + avgRelevance as episodeScore

      // Step 10: Return ranked episodes with ONLY entity-matched statements
      RETURN ep,
             entityMatchedStatements as statements,
             entityMatchCount,
             totalStmtCount,
             avgRelevance,
             connectivityScore,
             episodeScore

      ORDER BY episodeScore DESC, entityMatchCount DESC, totalStmtCount DESC
      LIMIT 20
    `;

    const params = {
      queryEntityIds,
      userId,
      queryEmbedding,
      validAt: options.endTime.toISOString(),
      ...(options.startTime && { startTime: options.startTime.toISOString() }),
      ...(options.spaceIds.length > 0 && { spaceIds: options.spaceIds }),
    };

    const records = await runQuery(cypher, params);

    const results: EpisodeGraphResult[] = records.map((record) => {
      const episode = record.get("ep").properties as EpisodicNode;
      const statements = record.get("statements").map((s: any) => s.properties as StatementNode);
      const entityMatchCount = typeof record.get("entityMatchCount") === 'bigint'
        ? Number(record.get("entityMatchCount"))
        : record.get("entityMatchCount");
      const totalStmtCount = typeof record.get("totalStmtCount") === 'bigint'
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

    // Log statement counts for debugging
    results.forEach((result, idx) => {
      logger.info(
        `Episode ${idx + 1}: entityMatches=${result.metrics.entityMatchCount}, ` +
        `totalStmtCount=${result.metrics.totalStatementCount}, ` +
        `returnedStatements=${result.statements.length}`
      );
    });

    logger.info(
      `Episode graph search: found ${results.length} episodes, ` +
      `top score: ${results[0]?.score.toFixed(2) || 'N/A'}`
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
  statementUuids: string[]
): Promise<Map<string, string>> {
  if (statementUuids.length === 0) {
    return new Map();
  }

  const cypher = `
    MATCH (s:Statement)<-[:HAS_PROVENANCE]-(e:Episode)
    WHERE s.uuid IN $statementUuids
    RETURN s.uuid as statementUuid, e.uuid as episodeUuid
  `;

  const records = await runQuery(cypher, { statementUuids });

  const map = new Map<string, string>();
  records.forEach(record => {
    map.set(record.get('statementUuid'), record.get('episodeUuid'));
  });

  return map;
}

/**
 * Group statements by their episode IDs efficiently
 */
export async function groupStatementsByEpisode(
  statements: StatementNode[]
): Promise<Map<string, StatementNode[]>> {
  const grouped = new Map<string, StatementNode[]>();

  if (statements.length === 0) {
    return grouped;
  }

  // Batch fetch episode IDs for all statements
  const episodeIdMap = await getEpisodeIdsForStatements(
    statements.map(s => s.uuid)
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
  episodeUuids: string[]
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
  records.forEach(record => {
    const episode = record.get('e').properties as EpisodicNode;
    map.set(episode.uuid, episode);
  });

  return map;
}
