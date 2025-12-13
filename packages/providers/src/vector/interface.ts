/**
 * IVectorProvider - Interface for vector database providers
 */

import type { Embedding, VectorSearchResult, SearchParams, VectorItem, VectorCapabilities } from "../types";

export interface IVectorProvider {
  /**
   * Insert or update a single vector
   */
  upsert(params: {
    id: string;
    vector: Embedding;
    content: string;
    metadata?: Record<string, any>;
    namespace?: string;
  }): Promise<void>;

  /**
   * Insert or update multiple vectors in batch
   */
  batchUpsert(items: VectorItem[], namespace?: string): Promise<void>;

  /**
   * Search for similar vectors
   */
  search(params: SearchParams): Promise<VectorSearchResult[]>;

  /**
   * Score specific vectors by ID (critical for BFS)
   */
  batchScore(params: {
    vector: Embedding;
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, number>>;

  /**
   * Delete vectors by ID
   */
  delete(params: {
    ids: string[];
    namespace?: string;
  }): Promise<void>;

  /**
   * Get a single vector by ID
   */
  get(params: {
    id: string;
    namespace?: string;
  }): Promise<Embedding | null>;

  /**
   * Get multiple vectors by IDs in batch
   */
  batchGet(params: {
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, Embedding>>;

  /**
   * Get provider name
   */
  getProviderName(): string;

  /**
   * Get provider capabilities
   */
  getCapabilities(): VectorCapabilities;

  /**
   * Health check
   */
  ping(): Promise<boolean>;

  /**
   * Close connections
   */
  close(): Promise<void>;

  /**
   * Initialize provider-specific infrastructure (indexes, collections, etc.)
   * This method should be idempotent and safe to call multiple times.
   *
   * @returns Promise<boolean> - true if initialization succeeded or was already done, false on failure
   */
  initializeInfrastructure?(): Promise<boolean>;
}
