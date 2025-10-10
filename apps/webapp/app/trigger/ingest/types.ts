/**
 * Shared type definitions for the ingestion pipeline
 */

// Token usage tracking structure
export interface TokenUsage {
  high: { input: number; output: number; total: number };
  low: { input: number; output: number; total: number };
}

// Output type for episode ingestion
export interface EpisodeIngestionOutput {
  episodeUuid: string | null;
  statementsCreated: number;
  entitiesCreated?: number;
  processingTimeMs?: number;
  tokenUsage?: TokenUsage;
}

// Output type for document ingestion (tracks multiple chunks)
export interface DocumentIngestionOutput {
  documentUuid: string | null;
  version: number;
  chunksProcessed: number;
  chunksSkipped: number;
  processingMode: string;
  differentialStrategy: string;
  estimatedSavings: string;
  statementInvalidation: {
    totalAnalyzed: number;
    invalidated: number;
    preserved: number;
  } | null;
  episodeHandlers?: string[];
  episodes: EpisodeIngestionOutput[];
  totalChunks: number;
}

// Union type for ingestion queue output
export type IngestionQueueOutput = EpisodeIngestionOutput | DocumentIngestionOutput;
