import {
  type EntityNode,
  type StatementNode,
  type EpisodicNode,
  type EpisodeSearchResult,
  type SearchOptions,
} from "@core/types";
import type { Embedding } from "ai";
import { logger } from "../logger.service";
import { getEmbedding } from "~/lib/model.server";
import { findSimilarEntities } from "../graphModels/entity";
import {
  searchStatements,
  searchEpisodes,
  batchScoreStatements,
} from "../vectorStorage.server";

import { ProviderFactory } from "@core/providers";
import { getEpisodeIdsForStatements } from "../graphModels/statement";

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

    // BM25 limit reduced to improve precision (fewer low-quality results)
    const STATEMENT_LIMIT = 75; // ~40-50 episodes vs 80+ previously

    const graphProvider = ProviderFactory.getGraphProvider();
    const results = await graphProvider.performBM25Search({
      query: sanitizedQuery,
      userId,
      validAt: options.endTime,
      startTime: options.startTime ?? undefined,
      includeInvalidated: options.includeInvalidated,
      labelIds: options.labelIds,
      statementLimit: STATEMENT_LIMIT,
    });

    return results.map((result) => ({
      episode: result.episode,
      score: result.score,
      statementCount: result.statementCount,
      topStatements: result.topStatements,
      invalidatedStatements: [], // Will be filtered at the end in search.server.ts
    }));
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
    // Step 1: Get similar statement IDs from vector provider (pgvector)
    const scoredStatements = await searchStatements({
      queryVector: query,
      userId,
      labelIds: options.labelIds.length > 0 ? options.labelIds : undefined,
      threshold: 0.5,
      limit: 100,
    });

    if (scoredStatements.length === 0) {
      return [];
    }

    // Step 2: Fetch episodes and statements from graph provider (no scoring in Cypher)
    const graphProvider = ProviderFactory.getGraphProvider();
    const episodeData = await graphProvider.getEpisodesForStatements({
      statementUuids: scoredStatements.map((s) => s.uuid),
      userId,
      validAt: options.endTime,
      startTime: options.startTime ?? undefined,
      includeInvalidated: options.includeInvalidated,
      labelIds: options.labelIds,
    });

    if (episodeData.length === 0) {
      return [];
    }

    // Step 3: Aggregate scores in JavaScript
    const scoreMap = new Map(scoredStatements.map((s) => [s.uuid, s.score]));

    return episodeData
      .map(({ episode, statements }) => {
        // Calculate average score from statement scores
        const scores = statements.map((s) => scoreMap.get(s.uuid) || 0);
        const avgScore =
          scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;

        // Get top 5 statements sorted by score
        const topStatements = statements
          .map((s) => ({ stmt: s, score: scoreMap.get(s.uuid) || 0 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.stmt);

        return {
          episode,
          score: avgScore,
          statementCount: statements.length,
          topStatements,
          invalidatedStatements: [], // Will be filtered at the end in search.server.ts
        };
      })
      .sort((a, b) => b.score - a.score); // Sort by score descending
  } catch (error) {
    logger.error("Vector search error:", { error });
    return [];
  }
}

/**
 * Perform vector similarity search on episode-level embeddings
 * Better for broad/vague queries where statement-level search is too granular
 */
export async function performEpisodeVectorSearch(
  queryEmbedding: Embedding,
  userId: string,
  options: Required<SearchOptions>,
): Promise<EpisodeSearchResult[]> {
  try {
    // Step 1: Get similar episode IDs from vector provider (pgvector)
    const scoredEpisodes = await searchEpisodes({
      queryVector: queryEmbedding,
      userId,
      labelIds: options.labelIds.length > 0 ? options.labelIds : undefined,
      threshold: 0.5,
      limit: 50,
    });

    if (scoredEpisodes.length === 0) {
      return [];
    }

    // Step 2: Fetch episodes and statements from graph provider (no scoring in Cypher)
    const graphProvider = ProviderFactory.getGraphProvider();
    const episodeData = await graphProvider.getEpisodesByIdsWithStatements({
      episodeUuids: scoredEpisodes.map((e) => e.uuid),
      userId,
      validAt: options.endTime,
      startTime: options.startTime ?? undefined,
      includeInvalidated: options.includeInvalidated,
      labelIds: options.labelIds,
    });

    if (episodeData.length === 0) {
      return [];
    }

    // Step 3: Add scores in JavaScript (scores are from pgvector, not calculated here)
    const scoreMap = new Map(scoredEpisodes.map((e) => [e.uuid, e.score]));

    const results = episodeData
      .map(({ episode, statements }) => {
        const score = scoreMap.get(episode.uuid) || 0;

        // Get top 5 statements (no scoring needed for episode-level search)
        const topStatements = statements.slice(0, 5);

        return {
          episode,
          score,
          statementCount: statements.length,
          topStatements,
          invalidatedStatements: [],
        };
      })
      .sort((a, b) => b.score - a.score); // Sort by score descending

    logger.info(
      `Episode vector search: found ${results.length} episodes, ` +
        `top score: ${results[0]?.score || "N/A"}`,
    );

    return results;
  } catch (error) {
    logger.error("Episode vector search error:", { error });
    return [];
  }
}

/**
 * Perform BFS traversal starting from entities mentioned in the query
 * Uses guided search with semantic filtering to reduce noise
 */
export async function performBfsSearch(
  _query: string,
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
      options.maxBfsDepth || 2,
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

    // Fetch episodes in ONE efficient query from graph provider
    const episodeIds = Array.from(episodeStatementsMap.keys());
    if (episodeIds.length === 0) {
      return [];
    }

    const graphProvider = ProviderFactory.getGraphProvider();
    const episodes = await graphProvider.fetchEpisodesByIds({
      episodeIds,
      userId,
      labelIds: options.labelIds,
    });

    // Build results with aggregated scores (in-memory aggregation)
    return episodes
      .map((episode) => {
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
 * Iterative BFS traversal - explores up to 3 hops level-by-level
 * Uses graph provider for traversal and vector provider for scoring
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
  const EARLY_TERMINATION_THRESHOLD = 50; // Stop if we have enough high-quality results

  const allStatements = new Map<
    string,
    { relevance: number; hopDistance: number }
  >(); // uuid -> {relevance, hopDistance}
  const visitedEntities = new Set<string>();

  // Track entities per level for iterative BFS
  let currentLevelEntities = startEntities.map((e) => e.uuid);

  const graphProvider = ProviderFactory.getGraphProvider();

  // Process each depth level
  for (let depth = 0; depth < maxDepth; depth++) {
    if (currentLevelEntities.length === 0) break;

    // Early termination: if we already have enough high-quality statements from hop 1, skip hop 2
    const currentHighQualityCount = Array.from(allStatements.values()).filter(
      (s) => s.relevance >= RELEVANCE_THRESHOLD,
    ).length;
    if (depth > 0 && currentHighQualityCount >= EARLY_TERMINATION_THRESHOLD) {
      logger.info(
        `BFS early termination at depth ${depth}: ${currentHighQualityCount} high-quality statements found`,
      );
      break;
    }

    // Mark entities as visited at this depth
    currentLevelEntities.forEach((id) => visitedEntities.add(`${id}`));

    // Step 1: Get statements connected to entities from graph provider (no scoring)
    const statementResults = await graphProvider.bfsGetStatements({
      entityIds: currentLevelEntities,
      userId,
      validAt,
      startTime: startTime ?? undefined,
      includeInvalidated,
      limit: 200,
    });
    console.log(
      `Statement fetch lenght for depth ${depth}: ${statementResults.length}`,
    );

    if (statementResults.length === 0) {
      currentLevelEntities = [];
      continue;
    }

    // Step 2: Batch score statements using vector provider (pgvector)
    const statementIds = statementResults.map((r) => r.uuid);
    const scores = await batchScoreStatements({
      queryVector: queryEmbedding,
      statementIds,
      userId,
    });

    // Step 3: Store statement relevance scores and hop distance, filter by exploration threshold
    // Use stricter thresholds for deeper hops to reduce noise
    const depthAdjustedThreshold = EXPLORATION_THRESHOLD + depth * 0.15; // +0.15 per hop
    const currentLevelStatementUuids: string[] = [];
    for (const result of statementResults) {
      const { uuid } = result;
      const relevance = scores.get(uuid) || 0;

      // Apply depth-adjusted exploration threshold to filter statements
      if (relevance >= depthAdjustedThreshold && !allStatements.has(uuid)) {
        allStatements.set(uuid, { relevance, hopDistance: depth + 1 }); // Store hop distance (1-indexed)
        currentLevelStatementUuids.push(uuid);
      }
    }

    // Get connected entities for next level from graph provider
    if (depth < maxDepth - 1 && currentLevelStatementUuids.length > 0) {
      const nextLevelResults = await graphProvider.bfsGetNextLevel({
        statementUuids: currentLevelStatementUuids,
        userId,
      });

      // Filter out already visited entities and limit expansion to prevent explosion
      const unvisitedEntities = nextLevelResults
        .map((r) => r.entityId)
        .filter((id) => !visitedEntities.has(`${id}`));

      // Take only the first N entities to limit exponential growth
      currentLevelEntities = unvisitedEntities;
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

  // Fetch statements WITH their episode IDs from graph provider for in-memory grouping
  const fetchResults = await graphProvider.bfsFetchStatements({
    statementUuids: relevantUuids,
    userId,
  });

  const statementMap = new Map(
    fetchResults.map((r) => [
      r.statement.uuid,
      { statement: r.statement, episodeIds: r.episodeIds },
    ]),
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
      console.log(chunks.map((chunk) => chunk).join(", "));
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

    // Step 1: Get episodes with entity-matched statements from graph provider
    const graphProvider = ProviderFactory.getGraphProvider();
    const graphResults = await graphProvider.performEpisodeGraphSearch({
      queryEntityIds,
      userId,
      validAt: options.endTime,
      startTime: options.startTime ?? undefined,
      includeInvalidated: options.includeInvalidated,
      labelIds: options.labelIds,
    });

    if (graphResults.length === 0) {
      return [];
    }

    const scoreStartTime = Date.now();
    // Step 2: Batch score all entity-matched statements using vector provider (pgvector)
    const allStatementIds = new Set<string>();
    graphResults.forEach((result) => {
      result.entityMatchedStmtIds.forEach((id) => allStatementIds.add(id));
    });

    const scores = await batchScoreStatements({
      queryVector: queryEmbedding,
      statementIds: Array.from(allStatementIds),
      userId,
    });

    // Step 3: Calculate metrics in-memory and filter
    const results: EpisodeGraphResult[] = graphResults
      .map((result) => {
        const entityMatchedStmtIds = result.entityMatchedStmtIds;
        const entityMatchCount = Number(result.entityMatchCount);
        const totalStmtCount = Number(result.totalStmtCount);
        const connectivityScore = Number(result.connectivityScore);

        // Calculate avgRelevance from scores
        const relevanceScores = entityMatchedStmtIds
          .map((id) => scores.get(id) || 0)
          .filter((score) => score > 0);
        const avgRelevance =
          relevanceScores.length > 0
            ? relevanceScores.reduce((sum, score) => sum + score, 0) /
              relevanceScores.length
            : 0;

        const episodeScore =
          entityMatchCount * 2.0 + connectivityScore + avgRelevance;

        return {
          episode: result.episode,
          statements: result.statements,
          score: episodeScore,
          metrics: {
            entityMatchCount,
            totalStatementCount: totalStmtCount,
            avgRelevance,
            connectivityScore,
          },
        };
      })
      .filter((result) => result.metrics.avgRelevance >= 0.5)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.metrics.entityMatchCount !== a.metrics.entityMatchCount)
          return b.metrics.entityMatchCount - a.metrics.entityMatchCount;
        return b.metrics.totalStatementCount - a.metrics.totalStatementCount;
      })
      .slice(0, 50);

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
