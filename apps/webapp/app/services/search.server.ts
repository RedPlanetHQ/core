import type { StatementNode } from "@core/types";
import { logger } from "./logger.service";
import { applyCrossEncoderReranking, applyWeightedRRF } from "./search/rerank";
import {
  getEpisodesByStatements,
  performBfsSearch,
  performBM25Search,
  performVectorSearch,
} from "./search/utils";
import { getEmbedding } from "~/lib/model.server";

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
  ): Promise<{ episodes: string[]; facts: string[] }> {
    // Default options

    const opts: Required<SearchOptions> = {
      limit: options.limit || 10,
      maxBfsDepth: options.maxBfsDepth || 4,
      validAt: options.validAt || new Date(),
      startTime: options.startTime || null,
      endTime: options.endTime || new Date(),
      includeInvalidated: options.includeInvalidated || false,
      entityTypes: options.entityTypes || [],
      predicateTypes: options.predicateTypes || [],
      scoreThreshold: options.scoreThreshold || 0.7,
      minResults: options.minResults || 10,
    };

    const queryVector = await this.getEmbedding(query);

    // 1. Run parallel search methods
    const [bm25Results, vectorResults, bfsResults] = await Promise.all([
      performBM25Search(query, userId, opts),
      performVectorSearch(queryVector, userId, opts),
      performBfsSearch(queryVector, userId, opts),
    ]);

    logger.info(
      `Search results - BM25: ${bm25Results.length}, Vector: ${vectorResults.length}, BFS: ${bfsResults.length}`,
    );

    // 2. Apply reranking strategy
    const rankedStatements = await this.rerankResults(
      query,
      { bm25: bm25Results, vector: vectorResults, bfs: bfsResults },
      opts,
    );

    // 3. Apply adaptive filtering based on score threshold and minimum count
    const filteredResults = this.applyAdaptiveFiltering(rankedStatements, opts);

    // 3. Return top results
    const episodes = await getEpisodesByStatements(filteredResults);
    return {
      episodes: episodes.map((episode) => episode.content),
      facts: filteredResults.map((statement) => statement.fact),
    };
  }

  /**
   * Apply adaptive filtering to ranked results
   * Uses a minimum quality threshold to filter out low-quality results
   */
  private applyAdaptiveFiltering(
    results: StatementNode[],
    options: Required<SearchOptions>,
  ): StatementNode[] {
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
      }

      return { result, score };
    });

    const hasScores = scoredResults.some((item) => item.score > 0);
    // If no scores are available, return the original results
    if (!hasScores) {
      logger.info("No scores found in results, skipping adaptive filtering");
      return options.limit > 0 ? results.slice(0, options.limit) : results;
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
      // For RRF or other compressed score ranges, use a percentile-based approach
      // Keep top 70% (or whatever is specified in options) of results
      const keepPercentage = 1 - (options.scoreThreshold || 0.3);
      const keepCount = Math.max(
        1,
        Math.ceil(scoredResults.length * keepPercentage),
      );

      // Set threshold to the score of the last item we want to keep
      threshold =
        keepCount < scoredResults.length
          ? scoredResults[keepCount - 1].score
          : 0;
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
      .map((item) => item.result);

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
    results: {
      bm25: StatementNode[];
      vector: StatementNode[];
      bfs: StatementNode[];
    },
    options: Required<SearchOptions>,
  ): Promise<StatementNode[]> {
    // Count non-empty result sources
    const nonEmptySources = [
      results.bm25.length > 0,
      results.vector.length > 0,
      results.bfs.length > 0,
    ].filter(Boolean).length;

    // If results are coming from only one source, use cross-encoder reranking
    if (nonEmptySources <= 1) {
      logger.info(
        "Only one source has results, falling back to cross-encoder reranking",
      );
      return applyCrossEncoderReranking(query, results);
    }

    // Otherwise use weighted RRF for multiple sources
    return applyWeightedRRF(results);
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
}
