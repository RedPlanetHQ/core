/**
 * StubVectorProvider - Placeholder for future vector providers
 */

import { IVectorProvider } from "./interface";
import type { Embedding, VectorSearchResult, SearchParams, VectorItem, VectorCapabilities } from "../types";

export class StubVectorProvider implements IVectorProvider {
  private providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  async upsert(params: {
    id: string;
    vector: Embedding;
    metadata?: Record<string, any>;
    namespace?: string;
  }): Promise<void> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async batchUpsert(items: VectorItem[], namespace?: string): Promise<void> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async search(params: SearchParams): Promise<VectorSearchResult[]> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async batchScore(params: {
    vector: Embedding;
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, number>> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async delete(params: {
    ids: string[];
    namespace?: string;
  }): Promise<void> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async get(params: {
    id: string;
    namespace?: string;
  }): Promise<Embedding | null> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  async batchGet(params: {
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, Embedding>> {
    throw new Error(`${this.providerName} provider not yet implemented`);
  }

  getProviderName(): string {
    return this.providerName;
  }

  getCapabilities(): VectorCapabilities {
    return {
      supportsMetadataFiltering: false,
      supportsNamespaces: false,
      maxBatchSize: 0,
      supportsHybridSearch: false,
    };
  }

  async ping(): Promise<boolean> {
    return false;
  }

  async close(): Promise<void> {
    // No-op
  }
}
