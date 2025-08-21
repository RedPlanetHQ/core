import { type StatementNode } from "@core/types";
import { combineAndDeduplicateStatements } from "./utils";
import { type CoreMessage } from "ai";
import { makeModelCall } from "~/lib/model.server";
import { logger } from "../logger.service";

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
 * Apply Weighted Reciprocal Rank Fusion to combine results
 */
export function applyWeightedRRF(results: {
  bm25: StatementNode[];
  vector: StatementNode[];
  bfs: StatementNode[];
}): StatementNode[] {
  // Determine weights based on query characteristics
  const weights = {
    bm25: 1.0,
    vector: 0.8,
    bfs: 0.5,
  };
  const k = 60; // RRF constant

  // Map to store combined scores
  const scores: Record<string, { score: number; statement: StatementNode }> =
    {};

  // Process BM25 results with their weight
  results.bm25.forEach((statement, rank) => {
    const uuid = statement.uuid;
    scores[uuid] = scores[uuid] || { score: 0, statement };
    scores[uuid].score += weights.bm25 * (1 / (rank + k));
  });

  // Process vector similarity results with their weight
  results.vector.forEach((statement, rank) => {
    const uuid = statement.uuid;
    scores[uuid] = scores[uuid] || { score: 0, statement };
    scores[uuid].score += weights.vector * (1 / (rank + k));
  });

  // Process BFS traversal results with their weight
  results.bfs.forEach((statement, rank) => {
    const uuid = statement.uuid;
    scores[uuid] = scores[uuid] || { score: 0, statement };
    scores[uuid].score += weights.bfs * (1 / (rank + k));
  });

  // Convert to array and sort by final score
  const sortedResults = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .map((item) => {
      // Add the RRF score to the statement for debugging
      return {
        ...item.statement,
        rrfScore: item.score,
      };
    });

  return sortedResults;
}

/**
 * Apply MMR (Maximal Marginal Relevance) reranking to reduce redundancy while maintaining relevance
 * MMR balances relevance and diversity to prevent redundant fact statements in results
 */
export function applyMMRReranking(
  statements: StatementNode[],
  lambda: number = 0.7, // Balance between relevance (1.0) and diversity (0.0)
  maxResults: number = 50,
): StatementNode[] {
  if (statements.length === 0) return [];

  // Extract relevance scores and embeddings
  const candidates = statements.map((statement) => {
    let relevanceScore = 0;

    // Use existing scores from MultiFactorReranking or other sources
    if ((statement as any).multifactorScore !== undefined) {
      relevanceScore = safeNumber((statement as any).multifactorScore);
    } else if ((statement as any).rrfScore !== undefined) {
      relevanceScore = safeNumber((statement as any).rrfScore);
    } else if ((statement as any).crossEncoderScore !== undefined) {
      relevanceScore = safeNumber((statement as any).crossEncoderScore);
    } else if ((statement as any).finalScore !== undefined) {
      relevanceScore = safeNumber((statement as any).finalScore);
    }

    return {
      statement,
      relevanceScore,
      embedding: statement.factEmbedding || [],
      selected: false,
    };
  });

  // Sort by relevance score (descending)
  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const selectedCandidates: typeof candidates = [];
  const remainingCandidates = [...candidates];

  // Pre-filter candidates with no embeddings for faster processing
  const candidatesWithEmbeddings = remainingCandidates.filter(
    (c) => c.embedding.length > 0,
  );
  const candidatesWithoutEmbeddings = remainingCandidates.filter(
    (c) => c.embedding.length === 0,
  );

  // MMR Selection Algorithm with optimizations
  while (
    selectedCandidates.length < maxResults &&
    remainingCandidates.length > 0
  ) {
    let bestCandidate = null;
    let bestScore = -Infinity;
    let bestIndex = -1;

    // Early termination: if we have enough high-relevance items, stop diversity checking
    const relevanceThreshold =
      selectedCandidates.length > 0
        ? selectedCandidates[selectedCandidates.length - 1].relevanceScore * 0.5
        : 0;

    for (let i = 0; i < remainingCandidates.length; i++) {
      const candidate = remainingCandidates[i];

      // Skip similarity calculation for very low relevance items
      if (
        candidate.relevanceScore < relevanceThreshold &&
        selectedCandidates.length > 3
      ) {
        continue;
      }

      let maxSimilarityToSelected = 0;

      // Only calculate similarity if candidate has embedding and we have selected items
      if (selectedCandidates.length > 0 && candidate.embedding.length > 0) {
        // Optimization: only check similarity with most recent selected items (last 5)
        const recentSelected = selectedCandidates.slice(
          -Math.min(5, selectedCandidates.length),
        );

        for (const selected of recentSelected) {
          if (selected.embedding.length > 0) {
            const similarity = cosineSimilarity(
              candidate.embedding,
              selected.embedding,
            );
            maxSimilarityToSelected = Math.max(
              maxSimilarityToSelected,
              similarity,
            );

            // Early exit: if similarity is very high, no need to check more
            if (similarity > 0.95) break;
          }
        }
      }

      // MMR Score: λ * relevance - (1-λ) * max_similarity_to_selected
      const mmrScore =
        lambda * candidate.relevanceScore -
        (1 - lambda) * maxSimilarityToSelected;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestCandidate = candidate;
        bestIndex = i;
      }
    }

    if (bestCandidate && bestIndex !== -1) {
      selectedCandidates.push(bestCandidate);
      remainingCandidates.splice(bestIndex, 1);
    } else {
      // No more candidates to select
      break;
    }
  }

  // Return selected statements with MMR scores
  return selectedCandidates.map((item, index) => ({
    ...item.statement,
    mmrScore: item.relevanceScore, // Keep original relevance score
    mmrRank: index + 1,
  }));
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Apply Cross-Encoder reranking to results
 * This is particularly useful when results come from a single source
 */
export async function applyCrossEncoderReranking(
  query: string,
  results: {
    bm25: StatementNode[];
    vector: StatementNode[];
    bfs: StatementNode[];
  },
): Promise<StatementNode[]> {
  // Combine all results
  const allResults = [...results.bm25, ...results.vector, ...results.bfs];

  // Deduplicate by UUID
  const uniqueResults = combineAndDeduplicateStatements(allResults);

  if (uniqueResults.length === 0) return [];

  logger.info(`Cross-encoder reranking ${uniqueResults.length} statements`);

  const finalStatements: StatementNode[] = [];

  await Promise.all(
    uniqueResults.map(async (statement) => {
      const messages: CoreMessage[] = [
        {
          role: "system",
          content: `You are an expert tasked with determining whether the statement is relevant to the query
            Respond with "True" if STATEMENT is relevant to QUERY and "False" otherwise.`,
        },
        {
          role: "user",
          content: `<QUERY>${query}</QUERY>\n<STATEMENT>${statement.fact}</STATEMENT>`,
        },
      ];

      let responseText = "";
      await makeModelCall(
        false,
        messages,
        (text) => {
          responseText = text;
        },
        { temperature: 0, maxTokens: 1 },
      );

      if (responseText === "True") {
        finalStatements.push(statement);
      }
    }),
  );

  return finalStatements;
}

/**
 * Apply combined MultiFactorReranking + MMR for optimal relevance and diversity
 * First applies MultiFactorReranking for authority/popularity/temporal scoring,
 * then applies MMR to reduce redundancy while maintaining relevance
 */
export function applyMultiFactorMMRReranking(
  results: {
    bm25: StatementNode[];
    vector: StatementNode[];
    bfs: StatementNode[];
  },
  options?: {
    lambda?: number; // MMR balance parameter (default: 0.7)
    maxResults?: number; // Maximum results to return (default: 50)
  },
): StatementNode[] {
  const { lambda = 0.7, maxResults = 50 } = options || {};

  // Step 1: Apply MultiFactorReranking to get relevance/authority/popularity scores
  const multiFactorResults = applyMultiFactorReranking(results);

  // Step 2: Apply MMR to reduce redundancy while maintaining relevance
  const mmrResults = applyMMRReranking(multiFactorResults, lambda, maxResults);

  // Add combined score for debugging
  return mmrResults.map((statement) => ({
    ...statement,
    combinedScore: safeNumber((statement as any).mmrScore), // MMR preserves MultiFactorScore
    rerankerUsed: "multifactor+mmr",
  }));
}

/**
 * Apply Multi-Factor Reranking combining semantic, structural, temporal, and provenance signals
 */
export function applyMultiFactorReranking(results: {
  bm25: StatementNode[];
  vector: StatementNode[];
  bfs: StatementNode[];
}): StatementNode[] {
  // Map to store combined scores and metadata
  const scores: Record<
    string,
    {
      score: number;
      statement: StatementNode;
      signals: { bm25: number; vector: number; bfs: number };
    }
  > = {};

  // Extract original scores when available (handle BigInt)
  const getOriginalScore = (statement: any) => {
    const rawScore =
      statement.similarity || statement.score || statement.bm25Score || 0;
    return safeNumber(rawScore);
  };

  // Process BM25 results - preserve original BM25 scores
  results.bm25.forEach((statement, rank) => {
    const uuid = statement.uuid;
    const originalScore = getOriginalScore(statement);
    const normalizedScore = Math.max(originalScore, 1 / (rank + 1)); // Rank fallback

    scores[uuid] = scores[uuid] || {
      score: 0,
      statement,
      signals: { bm25: 0, vector: 0, bfs: 0 },
    };
    scores[uuid].signals.bm25 = normalizedScore;
  });

  // Process vector similarity results - preserve semantic scores
  results.vector.forEach((statement, rank) => {
    const uuid = statement.uuid;
    const originalScore = getOriginalScore(statement);
    const normalizedScore = Math.max(originalScore, 1 / (rank + 1));

    scores[uuid] = scores[uuid] || {
      score: 0,
      statement,
      signals: { bm25: 0, vector: 0, bfs: 0 },
    };
    scores[uuid].signals.vector = normalizedScore;
  });

  // Process BFS traversal results - structural relevance
  results.bfs.forEach((statement, rank) => {
    const uuid = statement.uuid;
    const originalScore = getOriginalScore(statement);
    const normalizedScore = Math.max(originalScore, 1 / (rank + 1));

    scores[uuid] = scores[uuid] || {
      score: 0,
      statement,
      signals: { bm25: 0, vector: 0, bfs: 0 },
    };
    scores[uuid].signals.bfs = normalizedScore;
  });

  // Calculate final scores using adaptive weights
  Object.values(scores).forEach((item) => {
    const { bm25, vector, bfs } = item.signals;

    // Adaptive weights based on signal strength
    const totalSignals =
      (bm25 > 0 ? 1 : 0) + (vector > 0 ? 1 : 0) + (bfs > 0 ? 1 : 0);

    // Multi-signal bonus: statements appearing in multiple sources get higher weights
    const multiSignalBonus = totalSignals > 1 ? 1.2 : 1.0;

    // Dynamic weights: stronger for queries that benefit from each signal type
    const weights = {
      bm25: bm25 > 0 ? 1.0 : 0, // Keyword matching
      vector: vector > 0 ? 0.9 : 0, // Semantic similarity
      bfs: bfs > 0 ? 0.6 : 0, // Graph connectivity
    };

    // Temporal recency bonus (newer statements get slight boost)
    const createdAt = new Date(item.statement.createdAt).getTime();
    const now = Date.now();
    const daysSince = (now - createdAt) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0.9, 1.0 - (daysSince / 365) * 0.1); // Max 10% decay over 1 year

    // Popularity bonus based on recall count (log-scaled to prevent dominance)
    const recallCount = safeNumber(item.statement.recallCount);
    const popularityBonus = 1.0 + Math.log(1 + recallCount) * 0.15; // Up to ~30% boost for frequently recalled facts

    // Provenance authority bonus based on multiple source episodes
    const provenanceCount = Math.max(
      1,
      safeNumber(item.statement.provenanceCount),
    );
    const authorityBonus = 1.0 + Math.log(provenanceCount) * 0.2; // Up to ~35% boost for multi-source facts

    // Final weighted score with all bonuses
    item.score =
      (weights.bm25 * bm25 + weights.vector * vector + weights.bfs * bfs) *
      multiSignalBonus *
      recencyBonus *
      popularityBonus *
      authorityBonus;
  });

  // Convert to array and sort by final score
  const sortedResults = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .map((item) => {
      // console.log(item.statement.fact, item.score);
      // Add the reranking score and signal breakdown for debugging
      return {
        ...item.statement,
        multifactorScore: item.score,
        signals: item.signals,
      };
    });

  return sortedResults;
}
