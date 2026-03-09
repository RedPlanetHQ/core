/**
 * Turbopuffer Vector Provider Implementation
 * Vector database provider using Turbopuffer's REST API
 */

import type { EpisodeEmbedding } from "@core/database";
import type {
  Embedding,
  VectorSearchResult,
  SearchParams,
  VectorItem,
  VectorCapabilities,
} from "../types";
import type { IVectorProvider } from "./interface";
import { VECTOR_NAMESPACES } from "./constants";

interface TurbopufferConfig {
  apiKey: string;
  namespace?: string;
  embeddingSize: number;
}

const TURBOPUFFER_BASE_URL = "https://api.turbopuffer.com/v1";
const MAX_BATCH_SIZE = 256;

/**
 * Turbopuffer implementation using REST API
 *
 * Each CORE namespace maps to a separate Turbopuffer namespace prefixed with "core_".
 * Vectors are stored with string IDs, vectors, and attributes (metadata).
 * Distance metric: cosine_similarity
 */
export class TurbopufferVectorProvider implements IVectorProvider {
  private apiKey: string;
  private defaultNamespace: string;
  private embeddingSize: number;

  constructor(config: TurbopufferConfig) {
    this.apiKey = config.apiKey;
    this.defaultNamespace = config.namespace || VECTOR_NAMESPACES.STATEMENT;
    this.embeddingSize = config.embeddingSize;
  }

  /**
   * Get the Turbopuffer namespace name for a CORE namespace
   */
  private getNamespace(namespace?: string): string {
    return `core_${namespace || this.defaultNamespace}`;
  }

  /**
   * Make an authenticated request to the Turbopuffer API
   */
  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      body?: Record<string, any>;
    }
  ): Promise<T> {
    const url = `${TURBOPUFFER_BASE_URL}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[Turbopuffer] API error ${response.status}: ${errorText}`
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return {} as T;
  }

  /**
   * Upsert a single embedding
   */
  async upsert(params: {
    id: string;
    vector: Embedding;
    content: string;
    metadata?: Record<string, any>;
    namespace?: string;
  }): Promise<void> {
    const ns = this.getNamespace(params.namespace);

    const attributes: Record<string, string[]> = {
      content: [params.content],
    };

    if (params.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            attributes[key] = value.map(String);
          } else {
            attributes[key] = [String(value)];
          }
        }
      }
    }

    await this.request(`/vectors/${ns}`, {
      method: "POST",
      body: {
        ids: [params.id],
        vectors: [params.vector],
        attributes,
      },
    });
  }

  /**
   * Batch upsert embeddings
   */
  async batchUpsert(items: VectorItem[], namespace?: string): Promise<void> {
    if (items.length === 0) return;

    const ns = this.getNamespace(namespace);

    // Process in chunks of MAX_BATCH_SIZE
    for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
      const batch = items.slice(i, i + MAX_BATCH_SIZE);

      const ids: string[] = [];
      const vectors: Embedding[] = [];
      // Build column-oriented attributes
      const attributeKeys = new Set<string>();
      attributeKeys.add("content");

      // First pass: collect all attribute keys
      for (const item of batch) {
        if (item.metadata) {
          for (const key of Object.keys(item.metadata)) {
            attributeKeys.add(key);
          }
        }
      }

      // Build column-oriented attributes map
      const attributes: Record<string, (string | string[] | number | null)[]> = {};
      for (const key of attributeKeys) {
        attributes[key] = [];
      }

      // Second pass: populate columns
      for (const item of batch) {
        ids.push(item.id);
        vectors.push(item.vector);
        attributes["content"].push(item.content);

        for (const key of attributeKeys) {
          if (key === "content") continue;
          const value = item.metadata?.[key];
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              attributes[key].push(value.map(String));
            } else if (typeof value === "number") {
              attributes[key].push(value);
            } else {
              attributes[key].push(String(value));
            }
          } else {
            attributes[key].push(null);
          }
        }
      }

      await this.request(`/vectors/${ns}`, {
        method: "POST",
        body: {
          ids,
          vectors,
          attributes,
        },
      });
    }
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  async search(params: SearchParams): Promise<VectorSearchResult[]> {
    const ns = this.getNamespace(params.namespace);
    const limit = params.limit || 10;
    const threshold = params.threshold || 0;
    const { userId, workspaceId, labelIds, excludeIds, sessionId, version } =
      params.filter;

    // Build Turbopuffer filters
    const filters: any[] = [];

    // For label namespace, use workspaceId; otherwise use userId
    if (params.namespace === VECTOR_NAMESPACES.LABEL) {
      if (workspaceId) {
        filters.push(["workspaceId", "Eq", workspaceId]);
      }
    } else {
      if (userId) {
        filters.push(["userId", "Eq", userId]);
      }
      if (workspaceId) {
        filters.push(["workspaceId", "Eq", workspaceId]);
      }
    }

    if (labelIds && labelIds.length > 0) {
      // Filter episodes that have any of the specified label IDs
      for (const labelId of labelIds) {
        filters.push(["labelIds", "Eq", labelId]);
      }
    }

    if (excludeIds && excludeIds.length > 0) {
      for (const id of excludeIds) {
        filters.push(["id", "NotEq", id]);
      }
    }

    if (sessionId) {
      filters.push(["sessionId", "Eq", sessionId]);
    }

    if (version !== undefined && version !== null) {
      filters.push(["version", "Eq", version]);
    }

    const body: Record<string, any> = {
      vector: params.vector,
      top_k: threshold > 0 ? Math.max(limit * 2, 100) : limit,
      distance_metric: "cosine_similarity",
    };

    if (filters.length === 1) {
      body.filters = filters[0];
    } else if (filters.length > 1) {
      body.filters = ["And", filters];
    }

    const response = await this.request<{
      ids: string[];
      dist: number[];
      attributes?: Record<string, any[]>;
    }>(`/vectors/${ns}/query`, {
      method: "POST",
      body,
    });

    if (!response.ids || response.ids.length === 0) {
      return [];
    }

    let results: VectorSearchResult[] = response.ids.map(
      (id: string, index: number) => {
        const metadata: Record<string, any> = {};
        if (response.attributes) {
          for (const [key, values] of Object.entries(response.attributes)) {
            if (key !== "content" && values[index] !== null && values[index] !== undefined) {
              metadata[key] = values[index];
            }
          }
        }
        return {
          id,
          score: response.dist[index],
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        };
      }
    );

    // Apply threshold filter
    if (threshold > 0) {
      results = results.filter((r) => r.score >= threshold);
    }

    // Apply limit
    return results.slice(0, limit);
  }

  /**
   * Batch score specific vectors by ID
   */
  async batchScore(params: {
    vector: Embedding;
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, number>> {
    if (params.ids.length === 0) {
      return new Map();
    }

    const ns = this.getNamespace(params.namespace);
    const scores = new Map<string, number>();

    // Query with a filter to only match the specific IDs
    // Turbopuffer doesn't have a direct "score by ID" endpoint,
    // so we search with a high top_k and filter by IDs
    const idFilters = params.ids.map((id) => ["id", "Eq", id]);
    const filters = idFilters.length === 1 ? idFilters[0] : ["Or", idFilters];

    const response = await this.request<{
      ids: string[];
      dist: number[];
    }>(`/vectors/${ns}/query`, {
      method: "POST",
      body: {
        vector: params.vector,
        top_k: params.ids.length,
        distance_metric: "cosine_similarity",
        filters,
      },
    });

    if (response.ids) {
      for (let i = 0; i < response.ids.length; i++) {
        scores.set(response.ids[i], response.dist[i]);
      }
    }

    return scores;
  }

  /**
   * Delete vectors by ID
   */
  async delete(params: { ids: string[]; namespace?: string }): Promise<void> {
    if (params.ids.length === 0) return;

    const ns = this.getNamespace(params.namespace);

    await this.request(`/vectors/${ns}`, {
      method: "DELETE",
      body: {
        ids: params.ids,
      },
    });
  }

  /**
   * Get a single vector by ID
   */
  async get(params: {
    id: string;
    namespace?: string;
  }): Promise<Embedding | null> {
    const ns = this.getNamespace(params.namespace);

    try {
      // Use query endpoint with ID filter to retrieve the vector
      const response = await this.request<{
        ids: string[];
        vectors: Embedding[];
      }>(`/vectors/${ns}/query`, {
        method: "POST",
        body: {
          vector: new Array(this.embeddingSize).fill(0),
          top_k: 1,
          distance_metric: "cosine_similarity",
          filters: ["id", "Eq", params.id],
          include_vectors: true,
        },
      });

      if (!response.ids || response.ids.length === 0 || !response.vectors) {
        return null;
      }

      return response.vectors[0];
    } catch {
      return null;
    }
  }

  /**
   * Get multiple vectors by IDs in batch
   */
  async batchGet(params: {
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, Embedding>> {
    if (params.ids.length === 0) {
      return new Map();
    }

    const ns = this.getNamespace(params.namespace);
    const embeddings = new Map<string, Embedding>();

    try {
      const idFilters = params.ids.map((id) => ["id", "Eq", id]);
      const filters = idFilters.length === 1 ? idFilters[0] : ["Or", idFilters];

      const response = await this.request<{
        ids: string[];
        vectors: Embedding[];
      }>(`/vectors/${ns}/query`, {
        method: "POST",
        body: {
          vector: new Array(this.embeddingSize).fill(0),
          top_k: params.ids.length,
          distance_metric: "cosine_similarity",
          filters,
          include_vectors: true,
        },
      });

      if (response.ids && response.vectors) {
        for (let i = 0; i < response.ids.length; i++) {
          embeddings.set(response.ids[i], response.vectors[i]);
        }
      }
    } catch {
      // Return empty map on error
    }

    return embeddings;
  }

  /**
   * Add labels to episodes by episode UUIDs
   */
  async addLabelsToEpisodes(
    episodeUuids: string[],
    labelIds: string[],
    userId: string,
    workspaceId: string,
    forceUpdate: boolean = false
  ): Promise<number> {
    if (episodeUuids.length === 0 || labelIds.length === 0) {
      return 0;
    }

    const ns = this.getNamespace(VECTOR_NAMESPACES.EPISODE);
    let updatedCount = 0;

    // Fetch existing episodes to get their current data
    for (let i = 0; i < episodeUuids.length; i += MAX_BATCH_SIZE) {
      const batch = episodeUuids.slice(i, i + MAX_BATCH_SIZE);

      const idFilters = batch.map((id) => ["id", "Eq", id]);
      const filters: any[] = [
        "And",
        [
          ["userId", "Eq", userId],
          idFilters.length === 1 ? idFilters[0] : ["Or", idFilters],
        ],
      ];

      const response = await this.request<{
        ids: string[];
        vectors: Embedding[];
        attributes?: Record<string, any[]>;
      }>(`/vectors/${ns}/query`, {
        method: "POST",
        body: {
          vector: new Array(this.embeddingSize).fill(0),
          top_k: batch.length,
          distance_metric: "cosine_similarity",
          filters,
          include_vectors: true,
        },
      });

      if (!response.ids || response.ids.length === 0) continue;

      // Update each episode's labels
      const updatedIds: string[] = [];
      const updatedVectors: Embedding[] = [];
      const updatedAttributes: Record<string, any[]> = {};

      // Initialize attribute columns from response
      if (response.attributes) {
        for (const key of Object.keys(response.attributes)) {
          updatedAttributes[key] = [];
        }
      }
      if (!updatedAttributes["labelIds"]) {
        updatedAttributes["labelIds"] = [];
      }

      for (let j = 0; j < response.ids.length; j++) {
        updatedIds.push(response.ids[j]);
        updatedVectors.push(response.vectors[j]);

        // Copy existing attributes
        if (response.attributes) {
          for (const [key, values] of Object.entries(response.attributes)) {
            if (key === "labelIds") continue;
            if (!updatedAttributes[key]) {
              updatedAttributes[key] = [];
            }
            updatedAttributes[key].push(values[j]);
          }
        }

        // Merge or replace labels
        if (forceUpdate) {
          updatedAttributes["labelIds"].push(labelIds);
        } else {
          const existingLabels =
            (response.attributes?.["labelIds"]?.[j] as string[]) || [];
          const mergedLabels = Array.from(
            new Set([...existingLabels, ...labelIds])
          );
          updatedAttributes["labelIds"].push(mergedLabels);
        }
      }

      // Upsert the updated vectors
      await this.request(`/vectors/${ns}`, {
        method: "POST",
        body: {
          ids: updatedIds,
          vectors: updatedVectors,
          attributes: updatedAttributes,
        },
      });

      updatedCount += updatedIds.length;
    }

    return updatedCount;
  }

  /**
   * Add labels to episodes by session ID
   */
  async addLabelsToEpisodesBySessionId(
    sessionId: string,
    labelIds: string[],
    userId: string,
    workspaceId: string,
    forceUpdate: boolean = false
  ): Promise<number> {
    if (!sessionId || labelIds.length === 0) {
      return 0;
    }

    const ns = this.getNamespace(VECTOR_NAMESPACES.EPISODE);

    // Search for episodes matching this session
    const response = await this.request<{
      ids: string[];
      vectors: Embedding[];
      attributes?: Record<string, any[]>;
    }>(`/vectors/${ns}/query`, {
      method: "POST",
      body: {
        vector: new Array(this.embeddingSize).fill(0),
        top_k: 10000,
        distance_metric: "cosine_similarity",
        filters: [
          "And",
          [
            ["sessionId", "Eq", sessionId],
            ["userId", "Eq", userId],
          ],
        ],
        include_vectors: true,
      },
    });

    if (!response.ids || response.ids.length === 0) {
      return 0;
    }

    // Update labels for all matching episodes
    const updatedAttributes: Record<string, any[]> = {};

    if (response.attributes) {
      for (const key of Object.keys(response.attributes)) {
        updatedAttributes[key] = [];
      }
    }
    if (!updatedAttributes["labelIds"]) {
      updatedAttributes["labelIds"] = [];
    }

    for (let j = 0; j < response.ids.length; j++) {
      // Copy existing attributes
      if (response.attributes) {
        for (const [key, values] of Object.entries(response.attributes)) {
          if (key === "labelIds") continue;
          if (!updatedAttributes[key]) {
            updatedAttributes[key] = [];
          }
          updatedAttributes[key].push(values[j]);
        }
      }

      if (forceUpdate) {
        updatedAttributes["labelIds"].push(labelIds);
      } else {
        const existingLabels =
          (response.attributes?.["labelIds"]?.[j] as string[]) || [];
        const mergedLabels = Array.from(
          new Set([...existingLabels, ...labelIds])
        );
        updatedAttributes["labelIds"].push(mergedLabels);
      }
    }

    await this.request(`/vectors/${ns}`, {
      method: "POST",
      body: {
        ids: response.ids,
        vectors: response.vectors,
        attributes: updatedAttributes,
      },
    });

    return response.ids.length;
  }

  /**
   * Get episodes by ingestion queue ID
   */
  async getEpisodesByQueueId(queueId: string): Promise<EpisodeEmbedding[]> {
    const ns = this.getNamespace(VECTOR_NAMESPACES.EPISODE);

    const response = await this.request<{
      ids: string[];
      vectors: Embedding[];
      attributes?: Record<string, any[]>;
    }>(`/vectors/${ns}/query`, {
      method: "POST",
      body: {
        vector: new Array(this.embeddingSize).fill(0),
        top_k: 10000,
        distance_metric: "cosine_similarity",
        filters: ["ingestionQueueId", "Eq", queueId],
        include_vectors: true,
      },
    });

    if (!response.ids || response.ids.length === 0) {
      return [];
    }

    return this.mapToEpisodeEmbeddings(response);
  }

  /**
   * Get recent episodes for a user
   */
  async getRecentEpisodes(
    userId: string,
    limit: number,
    sessionId?: string,
    excludeIds?: string[],
    version?: number,
    workspaceId?: string
  ): Promise<EpisodeEmbedding[]> {
    const ns = this.getNamespace(VECTOR_NAMESPACES.EPISODE);

    const filters: any[] = [["userId", "Eq", userId]];

    if (workspaceId) {
      filters.push(["workspaceId", "Eq", workspaceId]);
    }

    if (sessionId) {
      filters.push(["sessionId", "Eq", sessionId]);
    }

    if (excludeIds && excludeIds.length > 0) {
      for (const id of excludeIds) {
        filters.push(["id", "NotEq", id]);
      }
    }

    if (version !== undefined && version !== null) {
      filters.push(["version", "Eq", version]);
    }

    const body: Record<string, any> = {
      vector: new Array(this.embeddingSize).fill(0),
      top_k: limit,
      distance_metric: "cosine_similarity",
      include_vectors: true,
    };

    if (filters.length === 1) {
      body.filters = filters[0];
    } else {
      body.filters = ["And", filters];
    }

    const response = await this.request<{
      ids: string[];
      vectors: Embedding[];
      attributes?: Record<string, any[]>;
    }>(`/vectors/${ns}/query`, {
      method: "POST",
      body,
    });

    if (!response.ids || response.ids.length === 0) {
      return [];
    }

    return this.mapToEpisodeEmbeddings(response);
  }

  /**
   * Map Turbopuffer response to EpisodeEmbedding array
   */
  private mapToEpisodeEmbeddings(response: {
    ids: string[];
    vectors: Embedding[];
    attributes?: Record<string, any[]>;
  }): EpisodeEmbedding[] {
    return response.ids.map((id, index) => {
      const metadata: Record<string, any> = {};

      if (response.attributes) {
        for (const [key, values] of Object.entries(response.attributes)) {
          if (values[index] !== null && values[index] !== undefined) {
            metadata[key] = values[index];
          }
        }
      }

      return {
        id,
        content: (response.attributes?.["content"]?.[index] as string) || "",
        embedding: response.vectors[index],
        metadata,
        // Map Turbopuffer attributes to EpisodeEmbedding fields
        userId: (response.attributes?.["userId"]?.[index] as string) || "",
        workspaceId: (response.attributes?.["workspaceId"]?.[index] as string) || null,
        vector: response.vectors[index],
        ingestionQueueId:
          (response.attributes?.["ingestionQueueId"]?.[index] as string) || null,
        labelIds:
          (response.attributes?.["labelIds"]?.[index] as string[]) || [],
        sessionId:
          (response.attributes?.["sessionId"]?.[index] as string) || null,
        version:
          (response.attributes?.["version"]?.[index] as number) || null,
        chunkIndex:
          (response.attributes?.["chunkIndex"]?.[index] as number) || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as EpisodeEmbedding;
    });
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return "turbopuffer";
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): VectorCapabilities {
    return {
      supportsMetadataFiltering: true,
      supportsNamespaces: true,
      maxBatchSize: MAX_BATCH_SIZE,
      supportsHybridSearch: false,
    };
  }

  /**
   * Health check - ping the Turbopuffer API
   */
  async ping(): Promise<boolean> {
    try {
      // Use a simple query against the default namespace to verify connectivity
      const ns = this.getNamespace();
      await this.request(`/vectors/${ns}/query`, {
        method: "POST",
        body: {
          vector: new Array(this.embeddingSize).fill(0),
          top_k: 1,
          distance_metric: "cosine_similarity",
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close connections (no-op for REST-based provider)
   */
  async close(): Promise<void> {
    // No persistent connections to close for REST API
  }

  /**
   * Initialize infrastructure (no-op for Turbopuffer - namespaces are created on first upsert)
   */
  async initializeInfrastructure(): Promise<boolean> {
    return true;
  }
}
