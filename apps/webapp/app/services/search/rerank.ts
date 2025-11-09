import { EpisodeWithProvenance, QUALITY_THRESHOLDS, QualityFilterResult, RerankConfig, SearchOptions, type StatementNode } from "@core/types";
import { combineAndDeduplicateStatements } from "./utils";
import { type CoreMessage } from "ai";
import { makeModelCall } from "~/lib/model.server";
import { logger } from "../logger.service";
import { CohereClientV2 } from "cohere-ai";
import { env } from "~/env.server";
import { createOllama } from "ollama-ai-provider-v2";

// Utility function to safely convert BigInt values to Number
function safeNumber(value: any): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Apply Cohere Rerank 3.5 to search results for improved question-to-fact matching
 * This is particularly effective for bridging the semantic gap between questions and factual statements
 */
export async function applyCohereReranking(
  query: string,
  results: {
    bm25: StatementNode[];
    vector: StatementNode[];
    bfs: StatementNode[];
  },
  options?: {
    limit?: number;
    model?: string;
    useLLMVerification?: boolean;
  },
): Promise<StatementNode[]> {
  const { model = "rerank-v3.5" } = options || {};
  const limit = 100;

  try {
    const startTime = Date.now();
    // Combine and deduplicate all results
    const allResults = [
      ...results.bm25.slice(0, 100),
      ...results.vector.slice(0, 100),
      ...results.bfs.slice(0, 100),
    ];
    const uniqueResults = combineAndDeduplicateStatements(allResults);
    console.log("Unique results:", uniqueResults.length);

    if (uniqueResults.length === 0) {
      logger.info("No results to rerank with Cohere");
      return [];
    }

    // Check for API key
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      logger.warn("COHERE_API_KEY not found, falling back to original results");
      return uniqueResults.slice(0, limit);
    }

    // Initialize Cohere client
    const cohere = new CohereClientV2({
      token: apiKey,
    });

    // Prepare documents for Cohere API
    const documents = uniqueResults.map((statement) => statement.fact);
    console.log("Documents:", documents);

    logger.info(
      `Cohere reranking ${documents.length} statements with model ${model}`,
    );
    logger.info(`Cohere query: "${query}"`);
    logger.info(`First 5 documents: ${documents.slice(0, 5).join(" | ")}`);

    // Call Cohere Rerank API
    const response = await cohere.rerank({
      query,
      documents,
      model,
      topN: Math.min(limit, documents.length),
    });

    console.log("Cohere reranking billed units:", response.meta?.billedUnits);

    // Log top 5 Cohere results for debugging
    logger.info(
      `Cohere top 5 results:\n${response.results
        .slice(0, 5)
        .map(
          (r, i) =>
            `  ${i + 1}. [${r.relevanceScore.toFixed(4)}] ${documents[r.index].substring(0, 80)}...`,
        )
        .join("\n")}`,
    );

    // Map results back to StatementNodes with Cohere scores
    const rerankedResults = response.results.map((result, index) => ({
      ...uniqueResults[result.index],
      cohereScore: result.relevanceScore,
      cohereRank: index + 1,
    }));
    // .filter((result) => result.cohereScore >= Number(env.COHERE_SCORE_THRESHOLD));

    const responseTime = Date.now() - startTime;
    logger.info(
      `Cohere reranking completed: ${rerankedResults.length} results returned in ${responseTime}ms`,
    );

    return rerankedResults;
  } catch (error) {
    logger.error("Cohere reranking failed:", { error });

    // Graceful fallback to original results
    const allResults = [...results.bm25, ...results.vector, ...results.bfs];
    const uniqueResults = combineAndDeduplicateStatements(allResults);

    return uniqueResults.slice(0, limit);
  }
}


/**
 * Apply Cohere Rerank to episodes for improved relevance ranking
 * Reranks at episode level using full episode content for better context
 */
export async function applyCohereEpisodeReranking<T extends { episode: { originalContent: string; uuid: string } }>(
  query: string,
  episodes: T[],
  options?: {
    limit?: number;
    model?: string;
  },
): Promise<T[]> {
  const startTime = Date.now();
  const limit = options?.limit || 20;
  const model = options?.model || "rerank-english-v3.0";

  try {
    if (episodes.length === 0) {
      logger.info("No episodes to rerank with Cohere");
      return [];
    }

    // Check for API key
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      logger.warn("COHERE_API_KEY not found, skipping Cohere episode reranking");
      return episodes.slice(0, limit);
    }

    // Initialize Cohere client
    const cohere = new CohereClientV2({
      token: apiKey,
    });

    // Prepare episode documents for Cohere
    // Use full episode content for maximum context
    const documents = episodes.map((ep) => ep.episode.originalContent);

    logger.info(
      `Cohere reranking ${episodes.length} episodes with model ${model}`,
    );

    // Call Cohere Rerank API
    const response = await cohere.rerank({
      query,
      documents,
      model,
      topN: Math.min(limit, documents.length),
    });

    logger.info(
      `Cohere episode reranking - billed units: ${response.meta?.billedUnits || 'N/A'}`
    );

    // Log top 5 Cohere results for debugging
    logger.info(
      `Cohere top 5 episodes:\n${response.results
        .slice(0, 5)
        .map(
          (r, i) =>
            `  ${i + 1}. [${r.relevanceScore.toFixed(4)}] Episode ${episodes[r.index].episode.uuid.slice(0, 8)}`,
        )
        .join("\n")}`,
    );

    // Map results back to episodes with Cohere scores
    const rerankedEpisodes = response.results.map((result) => ({
      ...episodes[result.index],
      cohereScore: result.relevanceScore,
    }));

    const responseTime = Date.now() - startTime;
    logger.info(
      `Cohere episode reranking completed: ${rerankedEpisodes.length} episodes in ${responseTime}ms`,
    );

    return rerankedEpisodes;
  } catch (error) {
    logger.error("Cohere episode reranking failed:", { error });
    // Graceful fallback to original episodes
    return episodes.slice(0, limit);
  }
}

/**
 * Apply Ollama-based reranking using a local rerank model
 * Uses embeddings endpoint with query+document concatenation
 */
export async function applyOllamaEpisodeReranking<
  T extends { episode: { originalContent: string; uuid: string } }
>(
  query: string,
  episodes: T[],
  options: {
    limit?: number;
    ollamaUrl: string;
    model: string;
  }
): Promise<(T & { rerankScore: number })[]> {
  const startTime = Date.now();
  const limit = options.limit || 20;

  try {
    if (episodes.length === 0) {
      logger.info("No episodes to rerank with Ollama");
      return [];
    }

    if (!options.ollamaUrl) {
      logger.warn("OLLAMA_URL not configured, skipping Ollama reranking");
      return episodes.slice(0, limit).map(ep => ({ ...ep, rerankScore: 0.5 }));
    }

    logger.info(
      `Ollama reranking ${episodes.length} episodes with model ${options.model} at ${options.ollamaUrl}`
    );

    // Score each episode using the rerank model
    // Reranker models in Ollama work by computing embeddings for query+document pairs
    const scoredEpisodes = await Promise.all(
      episodes.map(async (episode, index) => {
        try {
          // Call Ollama embeddings API directly with query and document
          const response = await fetch(`${options.ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: options.model,
              prompt: `query: ${query}\n\npassage: ${episode.episode.originalContent}`,
            }),
          });

          if (!response.ok) {
            logger.error(`Ollama rerank failed for episode ${index}: ${response.statusText}`);
            return { ...episode, rerankScore: 0 };
          }

          const result = await response.json();

          // For reranker models, the embedding represents a similarity score
          // Take the first dimension and normalize to 0-1 using sigmoid
          const rawScore = result.embedding[0];
          const normalizedScore = 1 / (1 + Math.exp(-rawScore));

          return { ...episode, rerankScore: normalizedScore };
        } catch (error) {
          logger.error(`Error scoring episode ${index} with Ollama:`, {error});
          return { ...episode, rerankScore: 0 };
        }
      })
    );

    // Sort by score descending
    const rerankedEpisodes = scoredEpisodes
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, limit);

    // Log top 5 results
    logger.info(
      `Ollama top 5 episodes:\n${rerankedEpisodes
        .slice(0, 5)
        .map(
          (ep, i) =>
            `  ${i + 1}. [${ep.rerankScore.toFixed(4)}] Episode ${ep.episode.uuid.slice(0, 8)}`
        )
        .join("\n")}`
    );

    const responseTime = Date.now() - startTime;
    logger.info(
      `Ollama episode reranking completed: ${rerankedEpisodes.length} episodes in ${responseTime}ms`
    );

    return rerankedEpisodes;
  } catch (error) {
    logger.error("Ollama episode reranking failed:", { error });
    // Graceful fallback
    return episodes.slice(0, limit).map(ep => ({ ...ep, rerankScore: 0.5 }));
  }
}

export async function applyMultiFactorReranking(
  query: string,
  episodes: EpisodeWithProvenance[],
  limit: number,
  options?: SearchOptions,
): Promise<(EpisodeWithProvenance & { rerankScore: number })[]> {
    // Stage 1: Rate episodes by source hierarchy (EpisodeGraph > BFS > Vector > BM25)
    const ratedEpisodes = rateEpisodesBySource(episodes);

    // Stage 2: Filter by quality (not by model capability)
    const qualityThreshold = options?.qualityThreshold || QUALITY_THRESHOLDS.HIGH_QUALITY_EPISODE;
    const qualityFilter = filterByQuality(ratedEpisodes, query, qualityThreshold);

    // If no high-quality matches, return empty
    if (qualityFilter.confidence < QUALITY_THRESHOLDS.NO_RESULT) {
      logger.warn(`Low confidence (${qualityFilter.confidence.toFixed(2)}) for query: "${query}"`);
      return [];
    }

    // Stage 3: Optional LLM validation for borderline confidence
    let finalEpisodes = qualityFilter.episodes;
    const useLLMValidation = options?.useLLMValidation || false;

    if (
      useLLMValidation &&
      qualityFilter.confidence >= QUALITY_THRESHOLDS.UNCERTAIN_RESULT &&
      qualityFilter.confidence < QUALITY_THRESHOLDS.CONFIDENT_RESULT
    ) {
      logger.info(
        `Borderline confidence (${qualityFilter.confidence.toFixed(2)}), using LLM validation`,
      );

      const maxEpisodesForLLM = options?.maxEpisodesForLLM || 20;
      finalEpisodes = await validateEpisodesWithLLM(
        query,
        qualityFilter.episodes,
        maxEpisodesForLLM,
      );

      if (finalEpisodes.length === 0) {
        logger.info('LLM validation rejected all episodes, returning empty');
        return [];
      }
    }

    // Normalize firstLevelScore to 0-1 range for consistency with Cohere/Ollama providers
    const episodesWithOriginalScore = finalEpisodes.map(ep => ({
      ...ep,
      originalScore: ep.firstLevelScore || 0,
    }));

    const normalized = normalizeScores(episodesWithOriginalScore);

    return normalized.map(ep => ({
      ...ep,
      rerankScore: ep.normalizedScore,
    }));
}

/**
 * Normalize scores to 0-1 range using min-max normalization
 */
function normalizeScores<T extends { originalScore: number }>(
  episodes: T[]
): (T & { normalizedScore: number })[] {
  if (episodes.length === 0) return [];

  const scores = episodes.map(ep => ep.originalScore);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;

  // Avoid division by zero
  if (range === 0) {
    return episodes.map(ep => ({ ...ep, normalizedScore: 1.0 }));
  }

  return episodes.map(ep => ({
    ...ep,
    normalizedScore: (ep.originalScore - minScore) / range,
  }));
}

/**
 * Unified episode reranking function that dispatches to the configured provider
 *
 * @param query - Search query
 * @param episodes - Episodes to rerank (must have originalScore for normalization)
 * @param config - Reranking configuration
 * @returns Reranked episodes with unified 'rerankScore' field (0-1 range)
 */
export async function applyEpisodeReranking(
  query: string,
  episodes: EpisodeWithProvenance[],
  config: RerankConfig,
  options?: SearchOptions
): Promise<(EpisodeWithProvenance & { rerankScore: number })[]> {
  const limit = config.limit || 20;

  if (episodes.length === 0) {
    logger.info("No episodes to rerank");
    return [];
  }

  // Cohere provider
  if (config.provider === "cohere" && config.cohereApiKey) {
    try {
      const cohereResults = await applyCohereEpisodeReranking(query, episodes, {
        limit,
        model: config.cohereModel,
      });

      // Map cohereScore to rerankScore for consistency
      return cohereResults.map((ep: any) => ({
        ...ep,
        rerankScore: ep.cohereScore,
      }));
    } catch (error) {
      logger.error("Cohere reranking failed, falling back to original algorithm:", {error});
      // Fallback to original multi-stage algorithm
      return applyMultiFactorReranking(query, episodes, limit, options);
    }
  }

  // Ollama provider
  if (config.provider === "ollama" && config.ollamaUrl && config.ollamaModel) {
    try {
      return await applyOllamaEpisodeReranking(query, episodes, {
        limit,
        ollamaUrl: config.ollamaUrl,
        model: config.ollamaModel,
      });
    } catch (error) {
      logger.error("Ollama reranking failed, falling back to original algorithm:", {error});
      // Fallback to original multi-stage algorithm
      return applyMultiFactorReranking(query, episodes, limit, options);
    }
  }

  // No reranking - use original multi-stage algorithm
  logger.info("RERANK_PROVIDER=none, using original multi-stage ranking algorithm");
  return applyMultiFactorReranking(query, episodes, limit, options);
}

/**
 * Helper to normalize original search scores and return in consistent format
 */
function normalizeOriginalScores<T extends { originalScore?: number }>(
  episodes: T[],
  limit: number
): (T & { rerankScore: number })[] {
  // Ensure all episodes have originalScore
  const episodesWithScores = episodes.map(ep => ({
    ...ep,
    originalScore: ep.originalScore ?? 0,
  }));

  // Normalize to 0-1 range
  const normalized = normalizeScores(episodesWithScores);

  // Sort by normalized score and apply limit
  return normalized
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, limit)
    .map(ep => ({
      ...ep,
      rerankScore: ep.normalizedScore,
    }));
}


  /**
   * Rate episodes by source hierarchy: Episode Graph > BFS > Vector > BM25
   * Now also boosts episodes by entity match count
   */
  function rateEpisodesBySource(
    episodes: EpisodeWithProvenance[]
  ): EpisodeWithProvenance[] {
    return episodes
      .map((ep) => {
        // Hierarchical scoring: EpisodeGraph > BFS > Vector > BM25
        let firstLevelScore = 0;

        // Episode Graph: Highest weight (5.0)
        if (ep.episodeGraphScore > 0) {
          firstLevelScore += ep.episodeGraphScore * 5.0;
        }

        // BFS: Second highest (3.0), already hop-weighted in extraction
        if (ep.bfsScore > 0) {
          firstLevelScore += ep.bfsScore * 3.0;
        }

        // Vector: Third (1.5)
        if (ep.vectorScore > 0) {
          firstLevelScore += ep.vectorScore * 1.5;
        }

        // BM25: Lowest (0.2), only significant if others missing
        // Reduced from 0.5 to 0.2 to prevent keyword noise from dominating
        if (ep.bm25Score > 0) {
          firstLevelScore += ep.bm25Score * 0.2;
        }

        // Concentration bonus: More statements = higher confidence
        const concentrationBonus = Math.log(1 + ep.statements.length) * 0.3;
        firstLevelScore *= 1 + concentrationBonus;

        // Entity match boost: More matching entities = higher relevance
        // Multiplicative boost to ensure episodes with more entity matches rank significantly higher
        // const entityMatchMultiplier = 1 + (ep.entityMatchCount * 0.5);
        // firstLevelScore *= entityMatchMultiplier;

        logger.debug(
          `Episode ${ep.episode.uuid.slice(0, 8)}: ` +
          `baseScore=${(firstLevelScore).toFixed(2)}, ` +
          // `entityMatches=${ep.entityMatchCount}, ` +
          // `multiplier=${entityMatchMultiplier.toFixed(2)}, ` +
          `finalScore=${firstLevelScore.toFixed(2)}`
        );

        return {
          ...ep,
          firstLevelScore,
        };
      })
      .sort((a, b) => (b.firstLevelScore || 0) - (a.firstLevelScore || 0));
  }

  /**
   * Filter episodes by quality, not by model capability
   * Returns empty if no high-quality matches found
   */
  function filterByQuality(
    ratedEpisodes: EpisodeWithProvenance[],
    query: string,
    baseQualityThreshold: number = QUALITY_THRESHOLDS.HIGH_QUALITY_EPISODE,
  ): QualityFilterResult {
    // Adaptive threshold based on available sources
    // This prevents filtering out ALL results when only Vector/BM25 are available
    const hasEpisodeGraph = ratedEpisodes.some((ep) => ep.episodeGraphScore > 0);
    const hasBFS = ratedEpisodes.some((ep) => ep.bfsScore > 0);
    const hasVector = ratedEpisodes.some((ep) => ep.vectorScore > 0);
    const hasBM25 = ratedEpisodes.some((ep) => ep.bm25Score > 0);

    let qualityThreshold: number;

    if (hasEpisodeGraph || hasBFS) {
      // Graph-based results available - use high threshold (5.0)
      // Max possible score with Episode Graph: ~10+ (5.0 * 2.0)
      // Max possible score with BFS: ~6+ (2.0 * 3.0)
      qualityThreshold = 5.0;
    } else if (hasVector) {
      // Only semantic vector search - use medium threshold (1.0)
      // Max possible score with Vector: ~1.5 (1.0 * 1.5)
      qualityThreshold = 1.0;
    } else if (hasBM25) {
      // Only keyword BM25 - use low threshold (0.3)
      // Max possible score with BM25: ~0.5 (1.0 * 0.5)
      qualityThreshold = 0.3;
    } else {
      // No results at all
      logger.warn(`No results from any source for query: "${query}"`);
      return {
        episodes: [],
        confidence: 0,
        message: 'No relevant information found in memory',
      };
    }

    logger.info(
      `Adaptive quality threshold: ${qualityThreshold.toFixed(1)} ` +
        `(EpisodeGraph: ${hasEpisodeGraph}, BFS: ${hasBFS}, Vector: ${hasVector}, BM25: ${hasBM25})`,
    );

    // 1. Filter to high-quality episodes only
    const highQualityEpisodes = ratedEpisodes.filter(
      (ep) => (ep.firstLevelScore || 0) >= qualityThreshold,
    );

    if (highQualityEpisodes.length === 0) {
      logger.info(`No high-quality matches for query: "${query}" (threshold: ${qualityThreshold})`);
      return {
        episodes: [],
        confidence: 0,
        message: 'No relevant information found in memory',
      };
    }

    // 2. Apply score gap detection to find natural cutoff
    const scores = highQualityEpisodes.map((ep) => ep.firstLevelScore || 0);
    const gapCutoff = findScoreGapForEpisodes(scores);

    // 3. Take episodes up to the gap
    const filteredEpisodes = highQualityEpisodes.slice(0, gapCutoff);

    // 4. Calculate overall confidence with adaptive normalization
    const confidence = calculateConfidence(filteredEpisodes);

    logger.info(
      `Quality filtering: ${filteredEpisodes.length}/${ratedEpisodes.length} episodes kept, ` +
        `confidence: ${confidence.toFixed(2)}`,
    );

    return {
      episodes: filteredEpisodes,
      confidence,
      message: `Found ${filteredEpisodes.length} relevant episodes`,
    };
  }


  /**
   * Calculate confidence score with adaptive normalization
   * Uses different max expected scores based on DOMINANT source (not just presence)
   *
   * IMPORTANT: BM25 is NEVER considered dominant - it's a fallback, not a quality signal.
   * When only Vector+BM25 exist, Vector is dominant.
   */
  function calculateConfidence(filteredEpisodes: EpisodeWithProvenance[]): number {
    if (filteredEpisodes.length === 0) return 0;

    const avgScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.firstLevelScore || 0), 0) /
      filteredEpisodes.length;

    // Calculate average contribution from each source (weighted)
    const avgEpisodeGraphScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.episodeGraphScore || 0), 0) /
      filteredEpisodes.length;

    const avgBFSScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.bfsScore || 0), 0) /
      filteredEpisodes.length;

    const avgVectorScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.vectorScore || 0), 0) /
      filteredEpisodes.length;

    const avgBM25Score =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.bm25Score || 0), 0) /
      filteredEpisodes.length;

    // Determine which source is dominant (weighted contribution to final score)
    // BM25 is EXCLUDED from dominant source detection - it's a fallback mechanism
    const episodeGraphContribution = avgEpisodeGraphScore * 5.0;
    const bfsContribution = avgBFSScore * 3.0;
    const vectorContribution = avgVectorScore * 1.5;
    const bm25Contribution = avgBM25Score * 0.2;

    let maxExpectedScore: number;
    let dominantSource: string;

    if (
      episodeGraphContribution > bfsContribution &&
      episodeGraphContribution > vectorContribution
    ) {
      // Episode Graph is dominant source
      maxExpectedScore = 25; // Typical range: 10-30
      dominantSource = 'EpisodeGraph';
    } else if (bfsContribution > vectorContribution) {
      // BFS is dominant source
      maxExpectedScore = 15; // Typical range: 5-15
      dominantSource = 'BFS';
    } else if (vectorContribution > 0) {
      // Vector is dominant source (even if BM25 contribution is higher)
      maxExpectedScore = 3; // Typical range: 1-3
      dominantSource = 'Vector';
    } else {
      // ONLY BM25 results (Vector=0, BFS=0, EpisodeGraph=0)
      // This should be rare and indicates low-quality keyword-only matches
      maxExpectedScore = 1; // Typical range: 0.3-1
      dominantSource = 'BM25';
    }

    const confidence = Math.min(1.0, avgScore / maxExpectedScore);

    logger.info(
      `Confidence: avgScore=${avgScore.toFixed(2)}, maxExpected=${maxExpectedScore}, ` +
        `confidence=${confidence.toFixed(2)}, dominantSource=${dominantSource} ` +
        `(Contributions: EG=${episodeGraphContribution.toFixed(2)}, ` +
        `BFS=${bfsContribution.toFixed(2)}, Vec=${vectorContribution.toFixed(2)}, ` +
        `BM25=${bm25Contribution.toFixed(2)})`,
    );

    return confidence;
  }

  /**
   * Find score gap in episode scores (similar to statement gap detection)
   */
  function findScoreGapForEpisodes(scores: number[], minResults: number = 3): number {
    if (scores.length <= minResults) {
      return scores.length;
    }

    // Find largest relative gap after minResults
    for (let i = minResults - 1; i < scores.length - 1; i++) {
      const currentScore = scores[i];
      const nextScore = scores[i + 1];

      if (currentScore === 0) break;

      const gap = currentScore - nextScore;
      const relativeGap = gap / currentScore;

      // If we find a cliff (>50% drop), cut there
      if (relativeGap > QUALITY_THRESHOLDS.MINIMUM_GAP_RATIO) {
        logger.info(
          `Episode gap detected at position ${i}: ${currentScore.toFixed(3)} → ${nextScore.toFixed(3)} ` +
            `(${(relativeGap * 100).toFixed(1)}% drop)`,
        );
        return i + 1; // Return count (index + 1)
      }
    }

    logger.info(`No significant gap found in episode scores`);

    // No significant gap found, return all
    return scores.length;
  }

  /**
   * Validate episodes with LLM for borderline confidence cases
   * Only used when confidence is between 0.3 and 0.7
   */
  async function validateEpisodesWithLLM(
    query: string,
    episodes: EpisodeWithProvenance[],
    maxEpisodes: number = 20,
  ): Promise<EpisodeWithProvenance[]> {
    const prompt = `Given user query, validate which episodes are truly relevant.

Query: "${query}"

Episodes (showing episode metadata and top statements):
${episodes
  .map(
    (ep, i) => `
${i + 1}. Episode: ${ep.episode.content || 'Untitled'} (${new Date(ep.episode.createdAt).toLocaleDateString()})
   First-level score: ${ep.firstLevelScore?.toFixed(2)}
   Sources: ${ep.sourceBreakdown.fromEpisodeGraph} EpisodeGraph, ${ep.sourceBreakdown.fromBFS} BFS, ${ep.sourceBreakdown.fromVector} Vector, ${ep.sourceBreakdown.fromBM25} BM25
   Total statements: ${ep.statements.length}

   Top statements:
${ep.statements
  .slice(0, 5)
  .map((s, idx) => `   ${idx + 1}) ${s.statement.fact}`)
  .join('\n')}
`,
  )
  .join('\n')}

Task: Validate which episodes DIRECTLY answer the query intent.

IMPORTANT RULES:
1. ONLY include episodes that contain information directly relevant to answering the query
2. If NONE of the episodes answer the query, return an empty array: []
3. Do NOT include episodes just because they share keywords with the query
4. Consider source quality: EpisodeGraph > BFS > Vector > BM25

Examples:
- Query "what is user name?" → Only include episodes that explicitly state a user's name
- Query "user home address" → Only include episodes with actual address information
- Query "random keywords" → Return [] if no episodes match semantically

Output format:
<output>
{
  "valid_episodes": [1, 3, 5]
}
</output>

If NO episodes are relevant to the query, return:
<output>
{
  "valid_episodes": []
}
</output>`;

    try {
      let responseText = '';
      await makeModelCall(
        false,
        [{ role: 'user', content: prompt }],
        (text) => {
          responseText = text;
        },
        { temperature: 0.2, maxTokens: 500 },
        'low', 
      );

      // Parse LLM response
      const outputMatch = /<output>([\s\S]*?)<\/output>/i.exec(responseText);
      if (!outputMatch?.[1]) {
        logger.warn('LLM validation returned no output, using all episodes');
        return episodes;
      }

      const result = JSON.parse(outputMatch[1]);
      const validIndices = result.valid_episodes || [];

      if (validIndices.length === 0) {
        logger.info('LLM validation: No episodes deemed relevant');
        return [];
      }

      logger.info(`LLM validation: ${validIndices.length}/${episodes.length} episodes validated`);

      // Return validated episodes
      return validIndices.map((idx: number) => episodes[idx - 1]).filter(Boolean);
    } catch (error) {
      logger.error('LLM validation failed:', { error });
      // Fallback: return original episodes
      return episodes;
    }
  }
