/**
 * Qdrant Vector Provider Implementation
 *
 * Vector database provider using Qdrant cloud or self-hosted instance.
 * Each namespace maps to a separate Qdrant collection (core_{namespace}).
 * Metadata is stored as payload with filtering support.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  Embedding,
  VectorSearchResult,
  SearchParams,
  VectorItem,
  VectorCapabilities,
} from "../types";
import type { IVectorProvider } from "./interface";
import { VECTOR_NAMESPACES } from "./constants";

// Re-export EpisodeEmbedding type for the interface
import type { EpisodeEmbedding } from "@core/database";

interface QdrantConfig {
  url: string;
  apiKey?: string;
  embeddingSize: number;
}

/**
 * Helper to compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

export class QdrantVectorProvider implements IVectorProvider {
  private client: QdrantClient;
  private embeddingSize: number;
  private infrastructureInitialized = false;

  private static readonly COLLECTION_PREFIX = "core_";
  private static readonly MAX_BATCH_SIZE = 100;

  /**
   * All known namespaces that need collections
   */
  private static readonly ALL_NAMESPACES = [
    VECTOR_NAMESPACES.ENTITY,
    VECTOR_NAMESPACES.STATEMENT,
    VECTOR_NAMESPACES.EPISODE,
    VECTOR_NAMESPACES.COMPACTED_SESSION,
    VECTOR_NAMESPACES.LABEL,
  ];

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.embeddingSize = config.embeddingSize;
  }

  /**
   * Get the Qdrant collection name for a namespace
   */
  private getCollectionName(namespace?: string): string {
    const ns = namespace || "statement";
    return `${QdrantVectorProvider.COLLECTION_PREFIX}${ns}`;
  }

  /**
   * Initialize Qdrant collections for all namespaces.
   * Creates collections with cosine distance if they don't exist.
   * This method is idempotent.
   */
  async initializeInfrastructure(): Promise<boolean> {
    if (this.infrastructureInitialized) {
      console.log("[Qdrant] Infrastructure already initialized, skipping...");
      return true;
    }

    try {
      console.log(
        `[Qdrant] Initializing collections with embedding size ${this.embeddingSize}...`
      );

      const existingCollections = await this.client.getCollections();
      const existingNames = new Set(
        existingCollections.collections.map((c) => c.name)
      );

      for (const namespace of QdrantVectorProvider.ALL_NAMESPACES) {
        const collectionName = this.getCollectionName(namespace);

        if (existingNames.has(collectionName)) {
          console.log(
            `[Qdrant] Collection ${collectionName} already exists, skipping...`
          );
          continue;
        }

        console.log(`[Qdrant] Creating collection ${collectionName}...`);
        await this.client.createCollection(collectionName, {
          vectors: {
            size: this.embeddingSize,
            distance: "Cosine",
          },
        });

        // Create payload indexes for common filter fields
        await this.client.createPayloadIndex(collectionName, {
          field_name: "userId",
          field_schema: "keyword",
        });
        await this.client.createPayloadIndex(collectionName, {
          field_name: "workspaceId",
          field_schema: "keyword",
        });

        if (namespace === VECTOR_NAMESPACES.EPISODE) {
          await this.client.createPayloadIndex(collectionName, {
            field_name: "sessionId",
            field_schema: "keyword",
          });
          await this.client.createPayloadIndex(collectionName, {
            field_name: "ingestionQueueId",
            field_schema: "keyword",
          });
          await this.client.createPayloadIndex(collectionName, {
            field_name: "labelIds",
            field_schema: "keyword",
          });
          await this.client.createPayloadIndex(collectionName, {
            field_name: "version",
            field_schema: "integer",
          });
          await this.client.createPayloadIndex(collectionName, {
            field_name: "createdAt",
            field_schema: "keyword",
          });
        }

        console.log(`[Qdrant] Created collection ${collectionName}`);
      }

      this.infrastructureInitialized = true;
      console.log(
        "[Qdrant] Infrastructure initialization completed successfully"
      );
      return true;
    } catch (error) {
      console.error("[Qdrant] Infrastructure initialization failed:", error);
      return false;
    }
  }

  /**
   * Extract a usable offset from Qdrant's next_page_offset, which can be
   * string | number | Record<string, unknown> | null | undefined.
   * Returns string | number | undefined for use in the scroll API.
   */
  private extractOffset(
    nextPageOffset: string | number | Record<string, unknown> | null | undefined
  ): string | number | undefined {
    if (nextPageOffset === null || nextPageOffset === undefined) {
      return undefined;
    }
    if (typeof nextPageOffset === "string" || typeof nextPageOffset === "number") {
      return nextPageOffset;
    }
    // Record<string, unknown> case - shouldn't happen in practice, treat as end
    return undefined;
  }

  /**
   * Build a Qdrant payload from metadata and content
   */
  private buildPayload(
    content: string,
    metadata?: Record<string, any>
  ): Record<string, any> {
    const payload: Record<string, any> = {
      content,
      ...(metadata || {}),
    };
    // Store createdAt for ordering in getRecentEpisodes
    if (!payload.createdAt) {
      payload.createdAt = new Date().toISOString();
    }
    return payload;
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
    const collectionName = this.getCollectionName(params.namespace);
    const payload = this.buildPayload(params.content, params.metadata);

    try {
      await this.client.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: params.id,
            vector: params.vector,
            payload,
          },
        ],
      });
    } catch (error) {
      console.error(
        `[Qdrant] Failed to upsert point ${params.id} in ${collectionName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Batch upsert embeddings, chunked to MAX_BATCH_SIZE
   */
  async batchUpsert(items: VectorItem[], namespace?: string): Promise<void> {
    if (items.length === 0) return;

    const collectionName = this.getCollectionName(namespace);

    try {
      // Chunk into batches of MAX_BATCH_SIZE
      for (
        let i = 0;
        i < items.length;
        i += QdrantVectorProvider.MAX_BATCH_SIZE
      ) {
        const batch = items.slice(i, i + QdrantVectorProvider.MAX_BATCH_SIZE);

        const points = batch.map((item) => ({
          id: item.id,
          vector: item.vector,
          payload: this.buildPayload(item.content, item.metadata),
        }));

        await this.client.upsert(collectionName, {
          wait: true,
          points,
        });
      }
    } catch (error) {
      console.error(
        `[Qdrant] Failed to batch upsert ${items.length} points in ${collectionName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Build Qdrant filter from search params
   */
  private buildSearchFilter(
    filter: SearchParams["filter"],
    namespace?: string
  ): Record<string, any> {
    const must: any[] = [];

    // For label namespace, use workspaceId instead of userId
    if (namespace === VECTOR_NAMESPACES.LABEL) {
      if (filter.workspaceId) {
        must.push({
          key: "workspaceId",
          match: { value: filter.workspaceId },
        });
      }
    } else {
      if (filter.userId) {
        must.push({
          key: "userId",
          match: { value: filter.userId },
        });
      }
      if (filter.workspaceId) {
        must.push({
          key: "workspaceId",
          match: { value: filter.workspaceId },
        });
      }
    }

    if (filter.sessionId) {
      must.push({
        key: "sessionId",
        match: { value: filter.sessionId },
      });
    }

    if (filter.version !== undefined && filter.version !== null) {
      must.push({
        key: "version",
        match: { value: filter.version },
      });
    }

    // Filter by labelIds using "any" match (array overlap)
    if (filter.labelIds && filter.labelIds.length > 0) {
      must.push({
        key: "labelIds",
        match: { any: filter.labelIds },
      });
    }

    const must_not: any[] = [];

    // Exclude specific IDs
    if (filter.excludeIds && filter.excludeIds.length > 0) {
      must_not.push({
        has_id: filter.excludeIds,
      });
    }

    const qdrantFilter: Record<string, any> = {};
    if (must.length > 0) qdrantFilter.must = must;
    if (must_not.length > 0) qdrantFilter.must_not = must_not;

    return qdrantFilter;
  }

  /**
   * Search for similar vectors
   */
  async search(params: SearchParams): Promise<VectorSearchResult[]> {
    const collectionName = this.getCollectionName(params.namespace);
    const limit = params.limit || 10;
    const threshold = params.threshold || 0;

    const filter = this.buildSearchFilter(params.filter, params.namespace);

    try {
      // For threshold, expand the search and then filter
      const expandedLimit = threshold > 0 ? Math.max(limit * 2, 100) : limit;

      const results = await this.client.search(collectionName, {
        vector: params.vector,
        limit: expandedLimit,
        score_threshold: threshold > 0 ? threshold : undefined,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        with_payload: true,
      });

      return results.slice(0, limit).map((result) => ({
        id: result.id as string,
        score: result.score,
        metadata: (result.payload as Record<string, any>) || undefined,
      }));
    } catch (error) {
      console.error(
        `[Qdrant] Search failed in ${collectionName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Score specific vectors by ID.
   * Retrieves points by IDs and computes cosine similarity manually.
   */
  async batchScore(params: {
    vector: Embedding;
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, number>> {
    if (params.ids.length === 0) {
      return new Map();
    }

    const collectionName = this.getCollectionName(params.namespace);
    const scores = new Map<string, number>();

    try {
      const points = await this.client.retrieve(collectionName, {
        ids: params.ids,
        with_vector: true,
      });

      for (const point of points) {
        const pointVector = point.vector as number[];
        if (pointVector) {
          const similarity = cosineSimilarity(params.vector, pointVector);
          scores.set(point.id as string, similarity);
        }
      }

      return scores;
    } catch (error) {
      console.error(
        `[Qdrant] Batch score failed in ${collectionName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete vectors by ID
   */
  async delete(params: { ids: string[]; namespace?: string }): Promise<void> {
    if (params.ids.length === 0) return;

    const collectionName = this.getCollectionName(params.namespace);

    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: params.ids,
      });
    } catch (error) {
      console.error(
        `[Qdrant] Delete failed in ${collectionName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get a single vector by ID
   */
  async get(params: {
    id: string;
    namespace?: string;
  }): Promise<Embedding | null> {
    const collectionName = this.getCollectionName(params.namespace);

    try {
      const points = await this.client.retrieve(collectionName, {
        ids: [params.id],
        with_vector: true,
      });

      if (points.length === 0) return null;

      const vector = points[0].vector as number[];
      return vector || null;
    } catch (error) {
      console.error(
        `[Qdrant] Get failed for ${params.id} in ${collectionName}:`,
        error
      );
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

    const collectionName = this.getCollectionName(params.namespace);
    const embeddings = new Map<string, Embedding>();

    try {
      const points = await this.client.retrieve(collectionName, {
        ids: params.ids,
        with_vector: true,
      });

      for (const point of points) {
        const vector = point.vector as number[];
        if (vector) {
          embeddings.set(point.id as string, vector);
        }
      }

      return embeddings;
    } catch (error) {
      console.error(
        `[Qdrant] Batch get failed in ${collectionName}:`,
        error
      );
      throw error;
    }
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

    const collectionName = this.getCollectionName(VECTOR_NAMESPACES.EPISODE);
    let updatedCount = 0;

    try {
      // Retrieve existing points to get their current labelIds
      const points = await this.client.retrieve(collectionName, {
        ids: episodeUuids,
        with_payload: true,
      });

      for (const point of points) {
        const payload = point.payload as Record<string, any> | null;
        if (!payload) continue;

        // Verify ownership
        if (payload.userId !== userId || payload.workspaceId !== workspaceId) {
          continue;
        }

        let newLabelIds: string[];
        if (forceUpdate) {
          newLabelIds = labelIds;
        } else {
          const existingLabelIds = (payload.labelIds as string[]) || [];
          newLabelIds = Array.from(
            new Set([...existingLabelIds, ...labelIds])
          );
        }

        await this.client.setPayload(collectionName, {
          payload: { labelIds: newLabelIds },
          points: [point.id as string],
          wait: true,
        });
        updatedCount++;
      }

      return updatedCount;
    } catch (error) {
      console.error("[Qdrant] Failed to add labels to episodes:", error);
      throw error;
    }
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

    const collectionName = this.getCollectionName(VECTOR_NAMESPACES.EPISODE);
    let updatedCount = 0;

    try {
      // Scroll through all episodes matching session and user
      const filter = {
        must: [
          { key: "sessionId", match: { value: sessionId } },
          { key: "userId", match: { value: userId } },
          { key: "workspaceId", match: { value: workspaceId } },
        ],
      };

      let nextOffset: string | number | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const scrollResult = await this.client.scroll(collectionName, {
          filter,
          limit: 100,
          offset: nextOffset,
          with_payload: true,
        });

        const points = scrollResult.points;
        if (points.length === 0) {
          hasMore = false;
          break;
        }

        for (const point of points) {
          const payload = point.payload as Record<string, any> | null;
          if (!payload) continue;

          let newLabelIds: string[];
          if (forceUpdate) {
            newLabelIds = labelIds;
          } else {
            const existingLabelIds = (payload.labelIds as string[]) || [];
            newLabelIds = Array.from(
              new Set([...existingLabelIds, ...labelIds])
            );
          }

          await this.client.setPayload(collectionName, {
            payload: { labelIds: newLabelIds },
            points: [point.id as string],
            wait: true,
          });
          updatedCount++;
        }

        nextOffset = this.extractOffset(scrollResult.next_page_offset);
        if (nextOffset === undefined) {
          hasMore = false;
        }
      }

      return updatedCount;
    } catch (error) {
      console.error(
        "[Qdrant] Failed to add labels to episodes by sessionId:",
        error
      );
      throw error;
    }
  }

  /**
   * Get episodes by ingestion queue ID
   */
  async getEpisodesByQueueId(queueId: string): Promise<EpisodeEmbedding[]> {
    const collectionName = this.getCollectionName(VECTOR_NAMESPACES.EPISODE);

    try {
      const filter = {
        must: [
          { key: "ingestionQueueId", match: { value: queueId } },
        ],
      };

      const results: EpisodeEmbedding[] = [];
      let nextOffset: string | number | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const scrollResult = await this.client.scroll(collectionName, {
          filter,
          limit: 100,
          offset: nextOffset,
          with_payload: true,
          with_vector: true,
        });

        for (const point of scrollResult.points) {
          const payload = point.payload as Record<string, any>;
          const vector = point.vector as number[];
          results.push(
            this.pointToEpisodeEmbedding(point.id as string, payload, vector)
          );
        }

        nextOffset = this.extractOffset(scrollResult.next_page_offset);
        if (nextOffset === undefined) {
          hasMore = false;
        }
      }

      return results;
    } catch (error) {
      console.error("[Qdrant] Failed to get episodes by queueId:", error);
      throw error;
    }
  }

  /**
   * Get recent episodes ordered by creation time
   */
  async getRecentEpisodes(
    userId: string,
    limit: number,
    sessionId?: string,
    excludeIds?: string[],
    version?: number,
    workspaceId?: string
  ): Promise<EpisodeEmbedding[]> {
    const collectionName = this.getCollectionName(VECTOR_NAMESPACES.EPISODE);

    try {
      const must: any[] = [
        { key: "userId", match: { value: userId } },
      ];

      if (workspaceId) {
        must.push({ key: "workspaceId", match: { value: workspaceId } });
      }

      if (sessionId) {
        must.push({ key: "sessionId", match: { value: sessionId } });
      }

      if (version !== undefined && version !== null) {
        must.push({ key: "version", match: { value: version } });
      }

      const must_not: any[] = [];
      if (excludeIds && excludeIds.length > 0) {
        must_not.push({ has_id: excludeIds });
      }

      const filter: Record<string, any> = {};
      if (must.length > 0) filter.must = must;
      if (must_not.length > 0) filter.must_not = must_not;

      // Qdrant doesn't natively support ordering by payload field,
      // so we scroll and sort client-side by createdAt descending
      const results: EpisodeEmbedding[] = [];
      let nextOffset: string | number | undefined = undefined;
      let hasMore = true;

      // Fetch more than needed to account for sorting; cap at a reasonable limit
      const fetchLimit = Math.min(limit * 3, 1000);

      while (hasMore && results.length < fetchLimit) {
        const batchSize = Math.min(100, fetchLimit - results.length);
        const scrollResult = await this.client.scroll(collectionName, {
          filter,
          limit: batchSize,
          offset: nextOffset,
          with_payload: true,
          with_vector: true,
        });

        for (const point of scrollResult.points) {
          const payload = point.payload as Record<string, any>;
          const vector = point.vector as number[];
          results.push(
            this.pointToEpisodeEmbedding(point.id as string, payload, vector)
          );
        }

        nextOffset = this.extractOffset(scrollResult.next_page_offset);
        if (nextOffset === undefined || scrollResult.points.length === 0) {
          hasMore = false;
        }
      }

      // Sort by createdAt descending and take the requested limit
      results.sort((a, b) => {
        const dateA = new Date(
          (a.metadata as Record<string, any>)?.createdAt || 0
        ).getTime();
        const dateB = new Date(
          (b.metadata as Record<string, any>)?.createdAt || 0
        ).getTime();
        return dateB - dateA;
      });

      return results.slice(0, limit);
    } catch (error) {
      console.error("[Qdrant] Failed to get recent episodes:", error);
      throw error;
    }
  }

  /**
   * Convert a Qdrant point to EpisodeEmbedding shape
   */
  private pointToEpisodeEmbedding(
    id: string,
    payload: Record<string, any>,
    vector: number[]
  ): EpisodeEmbedding {
    return {
      id,
      content: payload.content || "",
      embedding: vector,
      metadata: payload,
    } as unknown as EpisodeEmbedding;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return "qdrant";
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): VectorCapabilities {
    return {
      supportsMetadataFiltering: true,
      supportsNamespaces: true,
      maxBatchSize: QdrantVectorProvider.MAX_BATCH_SIZE,
      supportsHybridSearch: false,
    };
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    // QdrantClient uses HTTP REST, no persistent connection to close
  }
}
