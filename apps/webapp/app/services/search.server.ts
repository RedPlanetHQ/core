import type { EpisodicNode, StatementNode } from "@core/types";
import { logger } from "./logger.service";
import { applyLLMReranking } from "./search/rerank";
import {
  getEpisodesByStatements,
  performBfsSearch,
  performBM25Search,
  performVectorSearch,
} from "./search/utils";
import { getEmbedding } from "~/lib/model.server";
import { prisma } from "~/db.server";
import { runQuery } from "~/lib/neo4j.server";

/**
 * SearchService provides methods to search the reified + temporal knowledge graph
 * using a hybrid approach combining BM25, vector similarity, and BFS traversal.
 */
export class SearchService {
  async getEmbedding(text: string) {
    return getEmbedding(text);
  }

  /**
   * Search the knowledge graph using a hybrid approach
   * @param query The search query
   * @param userId The user ID for personalization
   * @param options Search options
   * @returns Array of relevant statements
   */
  public async search(
    query: string,
    userId: string,
    options: SearchOptions = {},
    source?: string,
  ): Promise<{
    episodes: string[];
    facts: {
      fact: string;
      validAt: Date;
      invalidAt: Date | null;
      relevantScore: number;
    }[];
  }> {
    const startTime = Date.now();
    // Default options

    const opts: Required<SearchOptions> = {
      limit: options.limit || 100,
      maxBfsDepth: options.maxBfsDepth || 4,
      validAt: options.validAt || new Date(),
      startTime: options.startTime || null,
      endTime: options.endTime || new Date(),
      includeInvalidated: options.includeInvalidated || true,
      entityTypes: options.entityTypes || [],
      predicateTypes: options.predicateTypes || [],
      scoreThreshold: options.scoreThreshold || 0.7,
      minResults: options.minResults || 10,
      spaceIds: options.spaceIds || [],
      adaptiveFiltering: options.adaptiveFiltering || false,
    };

    const queryVector = await this.getEmbedding(query);

    // 1. Run parallel search methods
    const [bm25Results, vectorResults, bfsResults] = await Promise.all([
      performBM25Search(query, userId, opts),
      performVectorSearch(queryVector, userId, opts),
      performBfsSearch(query, queryVector, userId, opts),
    ]);

    logger.info(
      `Search results - BM25: ${bm25Results.length}, Vector: ${vectorResults.length}, BFS: ${bfsResults.length}`,
    );

    // 2. Apply reranking strategy
    const rankedStatements = await this.rerankResults(
      query,
      userId,
      { bm25: bm25Results, vector: vectorResults, bfs: bfsResults },
      opts,
    );

    // // 3. Apply adaptive filtering based on score threshold and minimum count
    const filteredResults = this.applyAdaptiveFiltering(rankedStatements, opts);

    // 3. Return top results
    const episodes = await getEpisodesByStatements(
      filteredResults.map((item) => item.statement),
    );

    // Log recall asynchronously (don't await to avoid blocking response)
    const responseTime = Date.now() - startTime;
    this.logRecallAsync(
      query,
      userId,
      filteredResults.map((item) => item.statement),
      opts,
      responseTime,
      source,
    ).catch((error) => {
      logger.error("Failed to log recall event:", error);
    });

    this.updateRecallCount(
      userId,
      episodes,
      filteredResults.map((item) => item.statement),
    );

    return {
      episodes: episodes.map((episode) => episode.originalContent),
      facts: filteredResults.map((statement) => ({
        fact: statement.statement.fact,
        validAt: statement.statement.validAt,
        invalidAt: statement.statement.invalidAt || null,
        relevantScore: statement.score,
      })),
    };
  }

  /**
   * Apply adaptive filtering to ranked results
   * Uses a minimum quality threshold to filter out low-quality results
   */
  private applyAdaptiveFiltering(
    results: StatementNode[],
    options: Required<SearchOptions>,
  ): { statement: StatementNode; score: number }[] {
    if (results.length === 0) return [];

    let isRRF = false;
    // Extract scores from results
    const scoredResults = results.map((result) => {
      // Find the score based on reranking strategy used
      let score = 0;
      if ((result as any).rrfScore !== undefined) {
        score = (result as any).rrfScore;
        isRRF = true;
      } else if ((result as any).mmrScore !== undefined) {
        score = (result as any).mmrScore;
      } else if ((result as any).crossEncoderScore !== undefined) {
        score = (result as any).crossEncoderScore;
      } else if ((result as any).finalScore !== undefined) {
        score = (result as any).finalScore;
      } else if ((result as any).multifactorScore !== undefined) {
        score = (result as any).multifactorScore;
      } else if ((result as any).combinedScore !== undefined) {
        score = (result as any).combinedScore;
      } else if ((result as any).mmrScore !== undefined) {
        score = (result as any).mmrScore;
      } else if ((result as any).cohereScore !== undefined) {
        score = (result as any).cohereScore;
      }

      return { statement: result, score };
    });

    if (!options.adaptiveFiltering || results.length <= 5) {
      return scoredResults;
    }

    const hasScores = scoredResults.some((item) => item.score > 0);
    // If no scores are available, return the original results
    if (!hasScores) {
      logger.info("No scores found in results, skipping adaptive filtering");
      return options.limit > 0
        ? results
            .slice(0, options.limit)
            .map((item) => ({ statement: item, score: 0 }))
        : results.map((item) => ({ statement: item, score: 0 }));
    }

    // Sort by score (descending)
    scoredResults.sort((a, b) => b.score - a.score);

    // Calculate statistics to identify low-quality results
    const scores = scoredResults.map((item) => item.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const scoreRange = maxScore - minScore;

    let threshold = 0;
    if (isRRF || scoreRange < 0.01) {
      // For RRF scores, use a more lenient adaptive approach
      // Calculate median score and use a dynamic threshold based on score distribution
      const sortedScores = [...scores].sort((a, b) => b - a);
      const medianIndex = Math.floor(sortedScores.length / 2);
      const medianScore = sortedScores[medianIndex];

      // Use the smaller of: 20% of max score or 50% of median score
      // This is more lenient for broad queries while still filtering noise
      const maxBasedThreshold = maxScore * 0.2;
      const medianBasedThreshold = medianScore * 0.5;
      threshold = Math.min(maxBasedThreshold, medianBasedThreshold);

      // Ensure we keep at least minResults if available
      const minResultsCount = Math.min(
        options.minResults,
        scoredResults.length,
      );
      if (scoredResults.length >= minResultsCount) {
        const minResultsThreshold = scoredResults[minResultsCount - 1].score;
        threshold = Math.min(threshold, minResultsThreshold);
      }
    } else {
      // For normal score distributions, use the relative threshold approach
      const relativeThreshold = options.scoreThreshold || 0.3;
      const absoluteMinimum = 0.1;

      threshold = Math.max(
        absoluteMinimum,
        minScore + scoreRange * relativeThreshold,
      );
    }

    // Filter out low-quality results
    const filteredResults = scoredResults
      .filter((item) => item.score >= threshold)
      .map((item) => ({ statement: item.statement, score: item.score }));

    // Apply limit if specified
    const limitedResults =
      options.limit > 0
        ? filteredResults.slice(
            0,
            Math.min(filteredResults.length, options.limit),
          )
        : filteredResults;

    logger.info(
      `Quality filtering: ${limitedResults.length}/${results.length} results kept (threshold: ${threshold.toFixed(3)})`,
    );
    logger.info(
      `Score range: min=${minScore.toFixed(3)}, max=${maxScore.toFixed(3)}, threshold=${threshold.toFixed(3)}`,
    );

    return limitedResults;
  }

  /**
   * Apply the selected reranking strategy to search results
   */
  private async rerankResults(
    query: string,
    userId: string,
    results: {
      bm25: StatementNode[];
      vector: StatementNode[];
      bfs: StatementNode[];
    },
    options: Required<SearchOptions>,
  ): Promise<StatementNode[]> {
    // Fetch user profile for context
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, id: true },
    });

    const userContext = user
      ? { name: user.name ?? undefined, userId: user.id }
      : undefined;

    return applyLLMReranking(query, results, 10, userContext);
  }

  private async logRecallAsync(
    query: string,
    userId: string,
    results: StatementNode[],
    options: Required<SearchOptions>,
    responseTime: number,
    source?: string,
  ): Promise<void> {
    try {
      // Determine target type based on results
      let targetType = "mixed_results";
      if (results.length === 1) {
        targetType = "statement";
      } else if (results.length === 0) {
        targetType = "no_results";
      }

      // Calculate average similarity score if available
      let averageSimilarityScore: number | null = null;
      const scoresWithValues = results
        .map((result) => {
          // Try to extract score from various possible score fields
          const score =
            (result as any).rrfScore ||
            (result as any).mmrScore ||
            (result as any).crossEncoderScore ||
            (result as any).finalScore ||
            (result as any).score;
          return score && typeof score === "number" ? score : null;
        })
        .filter((score): score is number => score !== null);

      if (scoresWithValues.length > 0) {
        averageSimilarityScore =
          scoresWithValues.reduce((sum, score) => sum + score, 0) /
          scoresWithValues.length;
      }

      await prisma.recallLog.create({
        data: {
          accessType: "search",
          query,
          targetType,
          searchMethod: "hybrid", // BM25 + Vector + BFS
          minSimilarity: options.scoreThreshold,
          maxResults: options.limit,
          resultCount: results.length,
          similarityScore: averageSimilarityScore,
          context: JSON.stringify({
            entityTypes: options.entityTypes,
            predicateTypes: options.predicateTypes,
            maxBfsDepth: options.maxBfsDepth,
            includeInvalidated: options.includeInvalidated,
            validAt: options.validAt.toISOString(),
            startTime: options.startTime?.toISOString() || null,
            endTime: options.endTime.toISOString(),
          }),
          source: source ?? "search_api",
          responseTimeMs: responseTime,
          userId,
        },
      });

      logger.debug(
        `Logged recall event for user ${userId}: ${results.length} results in ${responseTime}ms`,
      );
    } catch (error) {
      logger.error("Error creating recall log entry:", { error });
      // Don't throw - we don't want logging failures to affect the search response
    }
  }

  private async updateRecallCount(
    userId: string,
    episodes: EpisodicNode[],
    statements: StatementNode[],
  ) {
    const episodeIds = episodes.map((episode) => episode.uuid);
    const statementIds = statements.map((statement) => statement.uuid);

    const cypher = `
      MATCH (e:Episode)
      WHERE e.uuid IN $episodeUuids and e.userId = $userId
      SET e.recallCount = coalesce(e.recallCount, 0) + 1
    `;
    await runQuery(cypher, { episodeUuids: episodeIds, userId });

    const cypher2 = `
      MATCH (s:Statement)
      WHERE s.uuid IN $statementUuids and s.userId = $userId
      SET s.recallCount = coalesce(s.recallCount, 0) + 1
    `;
    await runQuery(cypher2, { statementUuids: statementIds, userId });
  }
}

/**
 * Search options interface
 */
export interface SearchOptions {
  limit?: number;
  maxBfsDepth?: number;
  validAt?: Date;
  startTime?: Date | null;
  endTime?: Date;
  includeInvalidated?: boolean;
  entityTypes?: string[];
  predicateTypes?: string[];
  scoreThreshold?: number;
  minResults?: number;
  spaceIds?: string[]; // Filter results by specific spaces
  adaptiveFiltering?: boolean;
}
