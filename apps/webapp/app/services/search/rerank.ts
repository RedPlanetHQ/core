import {
  type EpisodeWithProvenance,
  type RerankConfig,
  type SearchOptions,
  type StatementNode,
} from "@core/types";
import { combineAndDeduplicateStatements } from "./utils";
import { makeModelCall } from "~/lib/model.server";
import { logger } from "../logger.service";
import { CohereClientV2 } from "cohere-ai";

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
export async function applyCohereEpisodeReranking<
  T extends {
    episode: { originalContent: string; uuid: string; content: string };
  },
>(
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
      logger.warn(
        "COHERE_API_KEY not found, skipping Cohere episode reranking",
      );
      return episodes.slice(0, limit);
    }

    // Initialize Cohere client
    const cohere = new CohereClientV2({
      token: apiKey,
    });

    // Prepare episode documents for Cohere
    // Use full episode content for maximum context
    const documents = episodes.map((ep) => ep.episode.content);

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
      `Cohere episode reranking - billed units: ${response.meta?.billedUnits || "N/A"}`,
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
  T extends { episode: { originalContent: string; uuid: string } },
>(
  query: string,
  episodes: T[],
  options: {
    limit?: number;
    ollamaUrl: string;
    model: string;
  },
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
      return episodes
        .slice(0, limit)
        .map((ep) => ({ ...ep, rerankScore: 0.5 }));
    }

    logger.info(
      `Ollama reranking ${episodes.length} episodes with model ${options.model} at ${options.ollamaUrl}`,
    );

    // Score each episode using the rerank model
    // Reranker models in Ollama work by computing embeddings for query+document pairs
    const scoredEpisodes = await Promise.all(
      episodes.map(async (episode, index) => {
        try {
          // Call Ollama embeddings API directly with query and document
          const response = await fetch(`${options.ollamaUrl}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: options.model,
              prompt: `query: ${query}\n\npassage: ${episode.episode.originalContent}`,
            }),
          });

          if (!response.ok) {
            logger.error(
              `Ollama rerank failed for episode ${index}: ${response.statusText}`,
            );
            return { ...episode, rerankScore: 0 };
          }

          const result = await response.json();

          // For reranker models, the embedding represents a similarity score
          // Take the first dimension and normalize to 0-1 using sigmoid
          const rawScore = result.embedding[0];
          const normalizedScore = 1 / (1 + Math.exp(-rawScore));

          return { ...episode, rerankScore: normalizedScore };
        } catch (error) {
          logger.error(`Error scoring episode ${index} with Ollama:`, {
            error,
          });
          return { ...episode, rerankScore: 0 };
        }
      }),
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
            `  ${i + 1}. [${ep.rerankScore.toFixed(4)}] Episode ${ep.episode.uuid.slice(0, 8)}`,
        )
        .join("\n")}`,
    );

    const responseTime = Date.now() - startTime;
    logger.info(
      `Ollama episode reranking completed: ${rerankedEpisodes.length} episodes in ${responseTime}ms`,
    );

    return rerankedEpisodes;
  } catch (error) {
    logger.error("Ollama episode reranking failed:", { error });
    // Graceful fallback
    return episodes.slice(0, limit).map((ep) => ({ ...ep, rerankScore: 0.5 }));
  }
}

export async function applyMultiFactorReranking(
  query: string,
  episodes: EpisodeWithProvenance[],
  limit: number,
  options?: SearchOptions,
): Promise<(EpisodeWithProvenance & { rerankScore: number })[]> {
  // Stage 1: Optional LLM validation for borderline confidence
  let finalEpisodes = episodes;

  const maxEpisodesForLLM = options?.maxEpisodesForLLM || 20;
  finalEpisodes = await validateEpisodesWithLLMInBatches(
    query,
    episodes,
    maxEpisodesForLLM,
  );

  if (finalEpisodes.length === 0) {
    logger.info("LLM validation rejected all episodes, returning empty");
    return [];
  }

  // Normalize firstLevelScore to 0-1 range for consistency with Cohere/Ollama providers
  const episodesWithOriginalScore = finalEpisodes.map((ep) => ({
    ...ep,
    originalScore: ep.firstLevelScore || 0,
  }));

  const normalized = normalizeScores(episodesWithOriginalScore);

  return normalized.map((ep) => ({
    ...ep,
    rerankScore: Number(ep.normalizedScore.toFixed(2)),
  }));
}

/**
 * Normalize scores to 0-1 range using min-max normalization
 */
function normalizeScores<T extends { originalScore: number }>(
  episodes: T[],
): (T & { normalizedScore: number })[] {
  if (episodes.length === 0) return [];

  const scores = episodes.map((ep) => ep.originalScore);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;

  // Avoid division by zero
  if (range === 0) {
    return episodes.map((ep) => ({ ...ep, normalizedScore: 1.0 }));
  }

  return episodes.map((ep) => ({
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
  options?: SearchOptions,
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
      logger.error(
        "Cohere reranking failed, falling back to original algorithm:",
        { error },
      );
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
      logger.error(
        "Ollama reranking failed, falling back to original algorithm:",
        { error },
      );
      // Fallback to original multi-stage algorithm
      return applyMultiFactorReranking(query, episodes, limit, options);
    }
  }

  // No reranking - use original multi-stage algorithm
  logger.info(
    "RERANK_PROVIDER=none, using original multi-stage ranking algorithm",
  );
  return applyMultiFactorReranking(query, episodes, limit, options);
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
${i + 1}. Episode: ${ep.episode.content || "Untitled"} (${new Date(ep.episode.createdAt).toLocaleDateString()})
   First-level score: ${ep.firstLevelScore?.toFixed(2)}
   Sources: ${ep.sourceBreakdown.fromEpisodeGraph} EpisodeGraph, ${ep.sourceBreakdown.fromBFS} BFS, ${ep.sourceBreakdown.fromVector} Vector, ${ep.sourceBreakdown.fromBM25} BM25
   Total statements: ${ep.statements.length}

   Top statements:
${ep.statements
  .slice(0, 5)
  .map((s, idx) => `   ${idx + 1}) ${s.statement.fact}`)
  .join("\n")}
`,
  )
  .join("\n")}

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
    let responseText = "";
    await makeModelCall(
      false,
      [{ role: "user", content: prompt }],
      (text) => {
        responseText = text;
      },
      { temperature: 0.2, maxTokens: 500 },
      "low",
      "search-rerank",
    );

    // Parse LLM response
    const outputMatch = /<output>([\s\S]*?)<\/output>/i.exec(responseText);
    if (!outputMatch?.[1]) {
      logger.warn("LLM validation returned no output, using all episodes");
      return episodes;
    }

    const result = JSON.parse(outputMatch[1]);
    const validIndices = result.valid_episodes || [];

    if (validIndices.length === 0) {
      logger.info("LLM validation: No episodes deemed relevant");
      return [];
    }

    logger.info(
      `LLM validation: ${validIndices.length}/${episodes.length} episodes validated`,
    );

    // Return validated episodes
    return validIndices.map((idx: number) => episodes[idx - 1]).filter(Boolean);
  } catch (error) {
    logger.error("LLM validation failed:", { error });
    // Fallback: return original episodes
    return episodes;
  }
}

/**
 * Validate episodes with LLM in parallel batches of 10
 * Processes multiple batches concurrently to improve performance
 */
async function validateEpisodesWithLLMInBatches(
  query: string,
  episodes: EpisodeWithProvenance[],
  maxEpisodes: number = 20,
): Promise<EpisodeWithProvenance[]> {
  const BATCH_SIZE = 10;

  // Limit to maxEpisodes
  const episodesToValidate = episodes.slice(0, maxEpisodes);

  if (episodesToValidate.length === 0) {
    return [];
  }

  logger.info(
    `Starting parallel LLM validation for ${episodesToValidate.length} episodes in batches of ${BATCH_SIZE}`,
  );

  // Split episodes into batches of 10
  const batches: EpisodeWithProvenance[][] = [];
  for (let i = 0; i < episodesToValidate.length; i += BATCH_SIZE) {
    batches.push(episodesToValidate.slice(i, i + BATCH_SIZE));
  }

  logger.info(`Created ${batches.length} batches for parallel processing`);

  // Process all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, batchIndex) =>
      validateEpisodesWithLLM(query, batch, batch.length).then((result) => {
        logger.info(
          `Batch ${batchIndex + 1}/${batches.length} completed: ${result.length}/${batch.length} episodes validated`,
        );
        return result;
      }),
    ),
  );

  // Combine all validated episodes from batches
  const allValidatedEpisodes = batchResults.flat();

  logger.info(
    `Parallel LLM validation completed: ${allValidatedEpisodes.length}/${episodesToValidate.length} total episodes validated`,
  );

  return allValidatedEpisodes;
}
