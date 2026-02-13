/**
 * PgVector Provider Implementation using Prisma
 * Vector database provider using PostgreSQL with pgvector extension via Prisma Client
 */

import { PrismaClient, Prisma, EpisodeEmbedding } from "@core/database";
import type {
  Embedding,
  VectorSearchResult,
  SearchParams,
  VectorItem,
  VectorCapabilities,
} from "../types";
import type { IVectorProvider } from "./interface";

interface PgVectorConfig {
  prisma: PrismaClient;
}

/**
 * PostgreSQL + pgvector implementation using Prisma Client
 *
 * Requirements:
 * - PostgreSQL 11+ with pgvector extension
 * - CREATE EXTENSION IF NOT EXISTS vector;
 * - Prisma models: StatementEmbedding, EpisodeEmbedding, EntityEmbedding
 *
 * Benefits over raw pg driver:
 * - Type safety with generated Prisma Client
 * - Connection pooling managed by Prisma
 * - Consistent with rest of CORE codebase
 * - Easier transaction handling
 *
 * Trade-offs:
 * - Uses $queryRaw for vector operations (pgvector operators not in Prisma schema)
 * - Slightly more overhead than raw SQL
 *
 * IMPORTANT: HNSW Index Usage Patterns
 * =====================================
 * HNSW indexes are optimized for ORDER BY vector <=> $query operations.
 * They CANNOT efficiently handle similarity thresholds in WHERE clauses.
 *
 * ✅ CORRECT (uses HNSW index):
 *    SELECT * FROM table
 *    WHERE userId = $1
 *    ORDER BY vector <=> $2
 *    LIMIT 100
 *
 * ❌ WRONG (bypasses HNSW index, causes full scan):
 *    SELECT * FROM table
 *    WHERE userId = $1
 *      AND (1 - (vector <=> $2)) >= 0.7
 *    ORDER BY vector <=> $2
 *    LIMIT 10
 *
 * ✅ CORRECT (use CTE pattern for threshold filtering):
 *    WITH candidates AS (
 *      SELECT *, (1 - (vector <=> $2)) as score
 *      FROM table
 *      WHERE userId = $1
 *      ORDER BY vector <=> $2
 *      LIMIT 100
 *    )
 *    SELECT * FROM candidates
 *    WHERE score >= 0.7
 *    LIMIT 10
 *
 * Multi-tenant optimization:
 * - B-tree indexes on userId ensure efficient user filtering
 * - HNSW indexes handle vector similarity within user's data
 * - Query planner uses userId B-tree first, then HNSW for ordering
 * - For very large single-user datasets (>100K vectors), consider partial HNSW indexes
 */
export class PgVectorProvider implements IVectorProvider {
  private prisma: PrismaClient;
  private dimensions: number;
  private infrastructureInitialized = false;

  private readonly INDEX_CONFIGS = [
    {
      table: "statement_embeddings",
      name: "statement_embeddings_vector_idx",
    },
    {
      table: "episode_embeddings",
      name: "episode_embeddings_vector_idx",
    },
    {
      table: "entity_embeddings",
      name: "entity_embeddings_vector_idx",
    },
    {
      table: "compacted_session_embeddings",
      name: "compacted_session_embeddings_vector_idx",
    },
    {
      table: "label_embeddings",
      name: "label_embeddings_vector_idx",
    },
  ] as const;

  constructor(config: PgVectorConfig) {
    this.prisma = config.prisma;
    // Get dimension from environment variable (same as vector-indexes.server.ts)
    this.dimensions = process.env.EMBEDDING_MODEL_SIZE
      ? parseInt(process.env.EMBEDDING_MODEL_SIZE, 10)
      : 1024;
  }

  /**
   * Initialize HNSW indexes for all embedding tables
   * This method is idempotent and safe to call multiple times
   *
   * @returns true if initialization succeeded or was already done, false on failure
   */
  async initializeInfrastructure(): Promise<boolean> {
    if (this.infrastructureInitialized) {
      console.log("[PgVector] Infrastructure already initialized, skipping...");
      return true;
    }

    try {
      console.log(`[PgVector] Initializing HNSW indexes with dimension ${this.dimensions}...`);

      // Create indexes if they don't exist
      for (const { table, name } of this.INDEX_CONFIGS) {
        await this.ensureIndex(table, name);
      }

      this.infrastructureInitialized = true;
      console.log("[PgVector] Infrastructure initialization completed successfully");
      return true;
    } catch (error) {
      console.error("[PgVector] Infrastructure initialization failed:", error);
      // Don't throw - allow app to start even if indexes fail
      // Vector search will work, just slower without indexes
      return false;
    }
  }

  /**
   * Ensure a single HNSW index exists (idempotent)
   * @private
   */
  private async ensureIndex(table: string, name: string): Promise<void> {
    try {
      // Check if index already exists
      const indexExists = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(
        Prisma.sql`
          SELECT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'core'
              AND tablename = ${table}
              AND indexname = ${name}
          ) as exists;
        `
      );

      if (indexExists[0]?.exists) {
        console.log(`[PgVector] Index ${name} already exists, skipping...`);
        return;
      }

      console.log(`[PgVector] Creating index ${name} on ${table}...`);

      // Create HNSW index with CONCURRENTLY to avoid blocking writes
      // Note: CONCURRENTLY cannot run inside a transaction block
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY ${name} ON ${table} USING hnsw ((vector::vector(${this.dimensions})) vector_cosine_ops);`
      );

      console.log(`[PgVector] ✓ Created index ${name}`);
    } catch (error) {
      console.error(`[PgVector] Failed to create index ${name}:`, error);
      throw error; // Propagate to parent handler
    }
  }

  /**
   * Get table name for namespace
   */
  private getTableName(namespace?: string): string {
    const tableName = namespace || "statement";
    return `${tableName}_embeddings`;
  }

  private getContentName(namespace?: string): string {
    switch (namespace) {
      case "statement":
        return "fact";
      case "episode":
        return "content";
      case "entity":
        return "name";
      case "compacted_session":
        return "summary";
      case "label":
        return "name";
      default:
        throw new Error(`Invalid namespace: ${namespace}`);
    }
  }

  /**
   * Upsert a single embedding using Prisma
   */
  async upsert(params: {
    id: string;
    vector: Embedding;
    content: string;
    metadata?: Record<string, any>;
    namespace?: string;
  }): Promise<void> {
    const tableName = this.getTableName(params.namespace);
    const contentName = this.getContentName(params.namespace);

    // Use $executeRaw for upsert with vector type
    // Note: Using Prisma.raw() for table/column names and regular template values for data
    const vectorString = `[${params.vector.join(",")}]`;
    const metadataString = JSON.stringify(params.metadata);

    // For label embeddings, use workspaceId instead of userId
    if (params.namespace === "label") {
      const workspaceId = params.metadata?.workspaceId;
      if (!workspaceId) {
        throw new Error("workspaceId is required in metadata for label upsert");
      }
      const description = params.metadata?.description || null;

      await this.prisma.$executeRaw`
        INSERT INTO ${Prisma.raw(tableName)} (id, "workspaceId", vector, metadata, ${Prisma.raw(`"${contentName}"`)}, "description", "createdAt", "updatedAt")
        VALUES (${params.id}, ${workspaceId}, ${vectorString}::vector, ${metadataString}::jsonb, ${params.content}, ${description}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET vector = EXCLUDED.vector,
            ${Prisma.raw(`"${contentName}"`)} = EXCLUDED.${Prisma.raw(`"${contentName}"`)},
            "description" = EXCLUDED."description",
            metadata = EXCLUDED.metadata,
            "updatedAt" = NOW()
      `;
      return;
    }

    // For all other namespaces, userId is required
    const userId = params.metadata?.userId;
    const workspaceId = params.metadata?.workspaceId;

    if (!userId) {
      throw new Error("userId is required in metadata for upsert");
    }

    // For episode embeddings, also store ingestionQueueId, labelIds, and sessionId
    if (params.namespace === "episode") {
      const ingestionQueueId = params.metadata?.ingestionQueueId;
      const labelIds = params.metadata?.labelIds || [];
      const sessionId = params.metadata?.sessionId;
      const version = params.metadata?.version;
      const chunkIndex = params.metadata?.chunkIndex;

      await this.prisma.$executeRaw`
        INSERT INTO ${Prisma.raw(tableName)} (id, "userId", "workspaceId", vector, metadata, ${Prisma.raw(`"${contentName}"`)}, "ingestionQueueId", "labelIds", "sessionId", "version", "chunkIndex", "createdAt", "updatedAt")
        VALUES (${params.id}, ${userId}, ${workspaceId}, ${vectorString}::vector, ${metadataString}::jsonb, ${params.content}, ${ingestionQueueId}, ${labelIds}, ${sessionId}, ${version}, ${chunkIndex}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET vector = EXCLUDED.vector,
            ${Prisma.raw(`"${contentName}"`)} = EXCLUDED.${Prisma.raw(`"${contentName}"`)},
            metadata = EXCLUDED.metadata,
            "ingestionQueueId" = EXCLUDED."ingestionQueueId",
            "labelIds" = EXCLUDED."labelIds",
            "sessionId" = EXCLUDED."sessionId",
            "version" = EXCLUDED."version",
            "chunkIndex" = EXCLUDED."chunkIndex",
            "updatedAt" = NOW()
      `;
    } else {
      // For other namespaces (statement, entity, compacted_session)
      await this.prisma.$executeRaw`
        INSERT INTO ${Prisma.raw(tableName)} (id, "userId", "workspaceId", vector, metadata, ${Prisma.raw(`"${contentName}"`)}, "createdAt", "updatedAt")
        VALUES (${params.id}, ${userId}, ${workspaceId}, ${vectorString}::vector, ${metadataString}::jsonb, ${params.content}, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET vector = EXCLUDED.vector,
            ${Prisma.raw(`"${contentName}"`)} = EXCLUDED.${Prisma.raw(`"${contentName}"`)},
            metadata = EXCLUDED.metadata,
            "updatedAt" = NOW()
      `;
    }
  }

  /**
   * Batch upsert embeddings using Prisma transaction
   */
  async batchUpsert(items: VectorItem[], namespace?: string): Promise<void> {
    if (items.length === 0) return;

    const tableName = this.getTableName(namespace);
    const contentName = this.getContentName(namespace);

    // Use Prisma transaction with extended timeout for large batches
    // Default timeout is 5s, we set to 60s to handle large batches
    await this.prisma.$transaction(
      async (tx) => {
        for (const item of items) {
          const userId = item.metadata?.userId;
          const workspaceId = item.metadata?.workspaceId;
          if (!userId) {
            throw new Error(`userId is required in metadata for item ${item.id}`);
          }

          const vectorString = `[${item.vector.join(",")}]`;
          const metadataString = JSON.stringify(item.metadata);

          await tx.$executeRaw`
          INSERT INTO ${Prisma.raw(tableName)} (id, "userId", "workspaceId", vector, metadata, ${Prisma.raw(`"${contentName}"`)}, "createdAt", "updatedAt")
          VALUES (
            ${item.id},
            ${userId},
            ${workspaceId},
            ${vectorString}::vector,
            ${metadataString}::jsonb,
            ${item.content},
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO UPDATE
          SET vector = EXCLUDED.vector,
              ${Prisma.raw(`"${contentName}"`)} = EXCLUDED.${Prisma.raw(`"${contentName}"`)},
              metadata = EXCLUDED.metadata,
              "updatedAt" = NOW()
        `;
        }
      },
      {
        maxWait: 60000, // 60 seconds max wait to acquire transaction
        timeout: 60000, // 60 seconds transaction timeout
      }
    );
  }

  /**
   * Search for similar vectors using cosine distance
   */
  async search(params: SearchParams): Promise<VectorSearchResult[]> {
    const tableName = this.getTableName(params.namespace);
    const limit = params.limit || 10;
    const threshold = params.threshold || 0;
    const { userId, labelIds, excludeIds, sessionId, version, workspaceId } = params.filter;

    // Use $queryRaw for vector similarity search
    // pgvector uses <=> for cosine distance
    // Convert distance to similarity: similarity = 1 - distance
    //
    // CRITICAL: We use a CTE (WITH clause) to let HNSW index work efficiently:
    // 1. First CTE uses HNSW index for ORDER BY (fast neighbor search)
    // 2. Outer query applies score threshold filter AFTER HNSW search
    // This avoids the performance trap of filtering by score in WHERE clause,
    // which would prevent HNSW index usage and force full table scan.
    //
    // IMPORTANT: Cast to exact dimension to match HNSW index: vector::vector(N)
    const expandedLimit = threshold > 0 ? Math.max(limit * 2, 100) : limit;

    // Build vector literal with explicit dimension using Prisma.raw for type modifier
    const vectorLiteral = Prisma.raw(`'[${params.vector.join(",")}]'::vector(${this.dimensions})`);
    const vectorCast = Prisma.raw(`vector::vector(${this.dimensions})`);

    // For label namespace, filter by workspaceId instead of userId
    if (params.namespace === "label") {
      if (!workspaceId) {
        throw new Error("workspaceId is required in filter for label search");
      }

      const results = await this.prisma.$queryRaw<
        Array<{
          id: string;
          score: number;
          metadata: any;
        }>
      >`
        WITH candidates AS (
          SELECT
            id::text,
            (1 - (${vectorCast} <=> ${vectorLiteral}))::float as score,
            metadata
          FROM ${Prisma.raw(tableName)}
          WHERE "workspaceId" = ${workspaceId}
          ORDER BY ${vectorCast} <=> ${vectorLiteral}
          LIMIT ${expandedLimit}
        )
        SELECT * FROM candidates
        WHERE score >= ${threshold}
        ORDER BY score DESC
        LIMIT ${limit}
      `;

      return results.map((row: any) => ({
        id: row.id,
        score: row.score,
        metadata: row.metadata,
      }));
    }

    // For all other namespaces, userId is required
    if (!userId) {
      throw new Error("userId is required in filter for search");
    }

    // Build labelIds filter condition
    const labelIdsCondition =
      labelIds && labelIds.length > 0
        ? Prisma.sql`AND "labelIds" && ARRAY[${Prisma.join(labelIds.map((id) => Prisma.sql`${id}`))}]::text[]`
        : Prisma.empty;

    // Build excludeIds filter condition
    const excludeIdsCondition =
      excludeIds && excludeIds.length > 0
        ? Prisma.sql`AND id::text NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}`))})`
        : Prisma.empty;

    const sessionIdCondition = sessionId
      ? Prisma.sql`AND "sessionId" = ${sessionId}`
      : Prisma.empty;

    const workspaceIdCondition = workspaceId
      ? Prisma.sql`AND "workspaceId" = ${workspaceId}`
      : Prisma.empty;

    const versionCondition = version ? Prisma.sql`AND "version" = ${version}` : Prisma.empty;

    // const startTime = Date.now();

    // Now run the actual query
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        score: number;
        metadata: any;
      }>
    >`
      WITH candidates AS (
        SELECT
          id::text,
          (1 - (${vectorCast} <=> ${vectorLiteral}))::float as score,
          metadata
        FROM ${Prisma.raw(tableName)}
        WHERE "userId" = ${userId}
          ${labelIdsCondition}
          ${excludeIdsCondition}
          ${sessionIdCondition}
          ${versionCondition}
          ${workspaceIdCondition}
        ORDER BY ${vectorCast} <=> ${vectorLiteral}
        LIMIT ${expandedLimit}
      )
      SELECT * FROM candidates
      WHERE score >= ${threshold}
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    // Enable this when debugging
    // const endTime = Date.now();
    // console.log(
    //   `[PgVector] Search completed: ${results.length} results in ${endTime - startTime}ms (wall clock)`
    // );

    return results.map((row: any) => ({
      id: row.id,
      score: row.score,
      metadata: row.metadata,
    }));
  }

  /**
   * Batch score specific vectors by ID (critical for BFS traversal)
   */
  async batchScore(params: {
    vector: Embedding;
    ids: string[];
    namespace?: string;
  }): Promise<Map<string, number>> {
    if (params.ids.length === 0) {
      return new Map();
    }

    const tableName = this.getTableName(params.namespace);

    // Use $queryRaw for batch scoring
    // Cast to explicit dimension for consistency with HNSW index
    const vectorLiteral = Prisma.raw(`'[${params.vector.join(",")}]'::vector(${this.dimensions})`);
    const vectorCast = Prisma.raw(`vector::vector(${this.dimensions})`);

    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        similarity: number;
      }>
    >`
      SELECT
        id::text,
        (1 - (${vectorCast} <=> ${vectorLiteral}))::float as similarity
      FROM ${Prisma.raw(tableName)}
      WHERE id::text = ANY(${params.ids})
    `;

    const scores = new Map<string, number>();
    for (const row of results) {
      scores.set(row.id, row.similarity);
    }

    return scores;
  }

  /**
   * Delete vectors by ID using Prisma
   */
  async delete(params: { ids: string[]; namespace?: string }): Promise<void> {
    if (params.ids.length === 0) return;

    const tableName = this.getTableName(params.namespace);

    // Use $executeRaw for delete with array
    await this.prisma.$executeRaw`
      DELETE FROM ${Prisma.raw(tableName)}
      WHERE id::text = ANY(${params.ids})
    `;
  }

  /**
   * Get a single vector by ID
   */
  async get(params: { id: string; namespace?: string }): Promise<Embedding | null> {
    const tableName = this.getTableName(params.namespace);

    const results = await this.prisma.$queryRaw<
      Array<{
        vector: string;
      }>
    >`
      SELECT vector::text
      FROM ${Prisma.raw(tableName)}
      WHERE id::text = ${params.id}
      LIMIT 1
    `;

    if (results.length === 0) return null;

    // Parse the text representation back to array of numbers
    return JSON.parse(results[0].vector) as Embedding;
  }

  /**
   * Get multiple vectors by IDs in batch
   */
  async batchGet(params: { ids: string[]; namespace?: string }): Promise<Map<string, Embedding>> {
    if (params.ids.length === 0) {
      return new Map();
    }

    const tableName = this.getTableName(params.namespace);

    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        vector: string;
      }>
    >`
      SELECT id::text, vector::text
      FROM ${Prisma.raw(tableName)}
      WHERE id::text = ANY(${params.ids})
    `;

    const embeddings = new Map<string, Embedding>();
    for (const row of results) {
      // Parse the text representation back to array of numbers
      embeddings.set(row.id, JSON.parse(row.vector) as Embedding);
    }

    return embeddings;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return "pgvector-prisma";
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): VectorCapabilities {
    return {
      supportsMetadataFiltering: true,
      supportsNamespaces: true,
      maxBatchSize: 1000,
      supportsHybridSearch: false,
    };
  }

  /**
   * Add labels to episodes by episode UUIDs
   * @param episodeUuids - Array of episode UUIDs to update
   * @param labelIds - Array of label IDs to add
   * @param userId - User ID for authorization
   * @param forceUpdate - If true, replace existing labels; if false, append to existing labels
   * @returns Number of episodes updated
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

    try {
      if (forceUpdate) {
        // Replace existing labels with new ones
        const result = await this.prisma.episodeEmbedding.updateMany({
          where: {
            id: { in: episodeUuids },
            userId,
            workspaceId,
          },
          data: {
            labelIds: labelIds,
          },
        });
        return result.count;
      } else {
        // Append labels to existing ones (need to fetch, merge, update)
        const episodes = await this.prisma.episodeEmbedding.findMany({
          where: {
            id: { in: episodeUuids },
            userId,
          },
          select: { id: true, labelIds: true },
        });

        // Update each episode with merged labels
        const updates = await Promise.all(
          episodes.map((episode) => {
            const mergedLabels = Array.from(new Set([...episode.labelIds, ...labelIds]));
            return this.prisma.episodeEmbedding.update({
              where: { id: episode.id },
              data: { labelIds: mergedLabels },
            });
          })
        );

        return updates.length;
      }
    } catch (error) {
      console.error("[PgVector] Failed to add labels to episodes:", error);
      throw error;
    }
  }

  /**
   * Add labels to episodes by session ID
   * @param sessionId - Session ID to filter episodes
   * @param labelIds - Array of label IDs to add
   * @param userId - User ID for authorization
   * @param forceUpdate - If true, replace existing labels; if false, append to existing labels
   * @returns Number of episodes updated
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

    try {
      if (forceUpdate) {
        // Replace existing labels with new ones
        const result = await this.prisma.episodeEmbedding.updateMany({
          where: {
            sessionId,
            userId,
            workspaceId,
          },
          data: {
            labelIds: labelIds,
          },
        });
        return result.count;
      } else {
        // Append labels to existing ones (need to fetch, merge, update)
        const episodes = await this.prisma.episodeEmbedding.findMany({
          where: {
            sessionId,
            workspaceId,
            userId,
          },
          select: { id: true, labelIds: true },
        });

        // Update each episode with merged labels
        const updates = await Promise.all(
          episodes.map((episode) => {
            const mergedLabels = Array.from(new Set([...episode.labelIds, ...labelIds]));
            return this.prisma.episodeEmbedding.update({
              where: { id: episode.id },
              data: { labelIds: mergedLabels },
            });
          })
        );

        return updates.length;
      }
    } catch (error) {
      console.error("[PgVector] Failed to add labels to episodes by sessionId:", error);
      throw error;
    }
  }

  async getEpisodesByQueueId(queueId: string): Promise<EpisodeEmbedding[]> {
    return await this.prisma.episodeEmbedding.findMany({ where: { ingestionQueueId: queueId } });
  }

  async getRecentEpisodes(
    userId: string,
    limit: number,
    sessionId?: string,
    excludeIds?: string[],
    version?: number,
    workspaceId?: string
  ): Promise<EpisodeEmbedding[]> {
    return await this.prisma.episodeEmbedding.findMany({
      where: {
        userId,
        ...(workspaceId && { workspaceId }),
        ...(sessionId && { sessionId }),
        ...(excludeIds && excludeIds.length > 0 && { id: { notIn: excludeIds } }),
        ...(version && { version }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
  /**
   * Health check - verify connection and pgvector extension
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ health: number }>>`
        SELECT 1 as health
      `;
      return result[0]?.health === 1;
    } catch (error) {
      return false;
    }
  }

  /**
   * Close connection (handled by Prisma lifecycle)
   * In Prisma, you typically don't manually close connections
   * They're managed by the connection pool
   */
  async close(): Promise<void> {
    // Prisma connections are managed by the application lifecycle
    // Typically you'd call prisma.$disconnect() at app shutdown
    // We don't disconnect here to avoid breaking shared Prisma instances
    await this.prisma.$disconnect();
  }
}
