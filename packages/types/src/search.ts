import { EpisodicNode, StatementNode } from "./graph";

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
  labelIds?: string[]; // Filter results by specific spaces
  adaptiveFiltering?: boolean;
  structured?: boolean; // Return structured JSON instead of markdown (default: false)
  useLLMValidation?: boolean; // Use LLM to validate episodes for borderline confidence cases (default: false)
  qualityThreshold?: number; // Minimum episode score to be considered high-quality (default: 5.0)
  maxEpisodesForLLM?: number; // Maximum episodes to send for LLM validation (default: 20)
  sortBy?: "relevance" | "recency"; // Sort results by relevance (default) or recency (newest first)
  tokenBudget?: number; // Token budget for recall output (default: 10000). Drops least relevant episodes from tail until total tokens <= budget
}

/**
 * Statement with source provenance tracking
 */
export interface StatementWithSource {
  statement: StatementNode;
  sources: {
    episodeGraph?: { score: number; entityMatches: number };
    episodeVector?: { score: number };
    bfs?: { score: number; hopDistance: number; relevance: number };
    vector?: { score: number; similarity: number };
    bm25?: { score: number; rank: number };
  };
  primarySource: "episodeGraph" | "episodeVector" | "bfs" | "vector" | "bm25";
}

/**
 * Episode with provenance tracking from multiple sources
 */
export interface EpisodeWithProvenance {
  episode: EpisodicNode;
  statements: StatementWithSource[];

  // Aggregated scores from each source
  episodeGraphScore: number;
  episodeVectorScore: number;
  bfsScore: number;
  vectorScore: number;
  bm25Score: number;

  // Source distribution
  sourceBreakdown: {
    fromEpisodeGraph: number;
    fromEpisodeVector: number;
    fromBFS: number;
    fromVector: number;
    fromBM25: number;
  };

  // Entity matching (number of query entities that match episode entities)
  entityMatchCount?: number;

  // First-level rating score (hierarchical)
  firstLevelScore?: number;
}

/**
 * Quality filtering result
 */
export interface QualityFilterResult {
  episodes: EpisodeWithProvenance[];
  confidence: number;
  message: string;
}

/**
 * Quality thresholds for filtering
 */
export const QUALITY_THRESHOLDS = {
  // Adaptive episode-level scoring (based on available sources)
  HIGH_QUALITY_EPISODE: 5.0, // For Episode Graph or BFS results (max score ~10+)
  MEDIUM_QUALITY_EPISODE: 1.0, // For Vector-only results (max score ~1.5)
  LOW_QUALITY_EPISODE: 0.3, // For BM25-only results (max score ~0.5)

  // Overall result confidence
  CONFIDENT_RESULT: 0.7, // High confidence, skip LLM validation
  UNCERTAIN_RESULT: 0.3, // Borderline, use LLM validation
  NO_RESULT: 0.3, // Too low, return empty

  // Score gap detection
  MINIMUM_GAP_RATIO: 0.5, // 50% score drop = gap
};

/**
 * Episode search result with aggregated scores and sample statements
 * Returned by BM25, Vector, and BFS searches
 */
export interface EpisodeSearchResult {
  episode: EpisodicNode;
  score: number; // Aggregated score from this search method
  statementCount: number; // Total statements found for this episode
  topStatements: StatementNode[]; // Top 5 statements for LLM validation
  invalidatedStatements: StatementNode[]; // For final response
}

/**
 * Configuration for reranking
 */
export interface RerankConfig {
  provider: "cohere" | "ollama" | "none";
  limit?: number;
  threshold: number;
  // Cohere-specific
  cohereApiKey?: string;
  cohereModel?: string;
  // Ollama-specific
  ollamaUrl?: string;
  ollamaModel?: string;
}
