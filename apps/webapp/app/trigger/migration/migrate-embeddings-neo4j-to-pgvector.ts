import { queue, task } from "@trigger.dev/sdk";
import { logger } from "~/services/logger.service";

import { initializeProvider, runQuery } from "~/trigger/utils/provider";
import { prisma } from "../utils/prisma";

export interface MigrateEmbeddingsPayload {
  userId?: string; // Migrate specific user, or all users if not provided
  batchSize?: number; // Number of embeddings to process per batch
  skipStatements?: boolean; // Skip statement embeddings
  skipEpisodes?: boolean; // Skip episode embeddings
  skipEntities?: boolean; // Skip entity embeddings
  skipCompactedSessions?: boolean; // Skip compacted session embeddings
  dryRun?: boolean; // If true, log what would be migrated without writing to pgvector
}

export interface MigrateEmbeddingsResult {
  success: boolean;
  statementsMigrated: number;
  episodesMigrated: number;
  entitiesMigrated: number;
  compactedSessionsMigrated: number;
  errors: string[];
}

/**
 * Migrate statement embeddings from Neo4j to pgvector
 */
async function migrateStatementEmbeddings(
  userId: string | undefined,
  batchSize: number,
  dryRun: boolean,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = [];
  let totalMigrated = 0;

  logger.info("Starting statement embeddings migration", { userId, dryRun });

  // First, count total records to migrate
  const countQuery = `
    ${userId ? "MATCH (s:Statement {userId: $userId})" : "MATCH (s:Statement)"}
    WHERE s.factEmbedding IS NOT NULL AND size(s.factEmbedding) > 0
    RETURN count(s) as total
  `;

  const countParams = userId ? { userId } : {};
  const countResult = await runQuery(countQuery, countParams);
  const totalRecords = countResult[0]?.get("total")?.toNumber() || 0;

  logger.info(`Found ${totalRecords} statements with embeddings in Neo4j`);

  if (totalRecords === 0) {
    return { migrated: 0, errors };
  }

  // Process in batches using SKIP/LIMIT to avoid loading all into memory
  for (let skip = 0; skip < totalRecords; skip += batchSize) {
    const query = `
      ${userId ? "MATCH (s:Statement {userId: $userId})" : "MATCH (s:Statement)"}
      WHERE s.factEmbedding IS NOT NULL AND size(s.factEmbedding) > 0
      RETURN s.uuid as statementId,
             s.userId as userId,
             s.fact as fact,
             s.factEmbedding as vector,
             labels(s) as labels
      ORDER BY s.createdAt
      SKIP ${skip}
      LIMIT ${batchSize}
    `;

    const params = {
      ...(userId ? { userId } : {}),
    };

    const result = await runQuery(query, params);
    const batch = result;

    logger.info(`Processing statements batch ${skip / batchSize + 1}`, {
      start: skip,
      end: Math.min(skip + batchSize, totalRecords),
      total: totalRecords,
    });

    if (dryRun) {
      logger.info(
        `[DRY RUN] Would migrate ${batch.length} statement embeddings`,
      );
      totalMigrated += batch.length;
      continue;
    }

    try {
      // Use Prisma transaction for batch insert with extended timeouts
      await prisma.$transaction(
        async (tx) => {
          for (const record of batch) {
            const statementId = record.get("statementId");
            const recordUserId = record.get("userId");
            const fact = record.get("fact");
            const vector = record.get("vector");
            const labels = record.get("labels") || [];

            // Extract label IDs (assuming labels follow a pattern or are stored separately)
            const labelIds = labels.filter((l: string) =>
              l.startsWith("label_"),
            );

            // Insert or update using raw SQL for vector type
            // Note: id field IS the statementId (no separate foreign key column)
            await tx.$executeRaw`
            INSERT INTO core.statement_embeddings (id, "userId", fact, vector, "labelIds", "createdAt", "updatedAt")
            VALUES (
              ${statementId}::uuid,
              ${recordUserId},
              ${fact},
              ${`[${vector.join(",")}]`}::vector,
              ${labelIds}::text[],
              NOW(),
              NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET vector = EXCLUDED.vector,
                fact = EXCLUDED.fact,
                "labelIds" = EXCLUDED."labelIds",
                "updatedAt" = NOW()
          `;

            totalMigrated++;
          }
        },
        {
          maxWait: 30000, // Wait up to 30s to acquire transaction
          timeout: 120000, // Allow transaction to run for 120s (2 minutes)
        },
      );

      logger.info(
        `Successfully migrated batch of ${batch.length} statement embeddings`,
      );
    } catch (error: any) {
      const errorMsg = `Error migrating statement embeddings batch ${skip / batchSize + 1}: ${error.message}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return { migrated: totalMigrated, errors };
}

/**
 * Migrate episode embeddings from Neo4j to pgvector
 */
async function migrateEpisodeEmbeddings(
  userId: string | undefined,
  batchSize: number,
  dryRun: boolean,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = [];
  let totalMigrated = 0;

  logger.info("Starting episode embeddings migration", { userId, dryRun });

  // First, count total records to migrate
  const countQuery = `
    ${userId ? "MATCH (e:Episode {userId: $userId})" : "MATCH (e:Episode)"}
    WHERE e.contentEmbedding IS NOT NULL AND size(e.contentEmbedding) > 0
    RETURN count(e) as total
  `;

  const countParams = userId ? { userId } : {};
  const countResult = await runQuery(countQuery, countParams);
  const totalRecords = countResult[0]?.get("total")?.toNumber() || 0;

  logger.info(`Found ${totalRecords} episodes with embeddings in Neo4j`);

  if (totalRecords === 0) {
    return { migrated: 0, errors };
  }

  // Process in batches using SKIP/LIMIT to avoid loading all into memory
  for (let skip = 0; skip < totalRecords; skip += batchSize) {
    const query = `
      ${userId ? "MATCH (e:Episode {userId: $userId})" : "MATCH (e:Episode)"}
      WHERE e.contentEmbedding IS NOT NULL AND size(e.contentEmbedding) > 0
      RETURN e.uuid as episodeId,
             e.userId as userId,
             e.content as content,
             e.contentEmbedding as vector,
             e.sessionId as sessionId,
             e.queueId as ingestionQueueId,
             e.labelIds as labelIds
      ORDER BY e.createdAt
      SKIP ${skip}
      LIMIT ${batchSize}
    `;

    const params = {
      ...(userId ? { userId } : {}),
    };

    const result = await runQuery(query, params);
    const batch = result;

    logger.info(`Processing episodes batch ${skip / batchSize + 1}`, {
      start: skip,
      end: Math.min(skip + batchSize, totalRecords),
      total: totalRecords,
    });

    if (dryRun) {
      logger.info(`[DRY RUN] Would migrate ${batch.length} episode embeddings`);
      totalMigrated += batch.length;
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const record of batch) {
            const episodeId = record.get("episodeId");
            const recordUserId = record.get("userId");
            const content = record.get("content");
            const vector = record.get("vector");
            const sessionId = record.get("sessionId");
            const ingestionQueueId = record.get("ingestionQueueId");
            const labelIds = record.get("labelIds") || [];

            // Skip if ingestionQueueId is missing (required field)
            if (!ingestionQueueId) {
              logger.warn(
                `Skipping episode ${episodeId}: missing ingestionQueueId`,
              );
              continue;
            }

            const iq = await tx.ingestionQueue.findUnique({
              where: {
                id: ingestionQueueId,
              },
            });

            if (!iq) {
              continue;
            }

            await tx.$executeRaw`
            INSERT INTO core.episode_embeddings (id, "userId", content, vector, "labelIds", "sessionId", "ingestionQueueId", "createdAt", "updatedAt")
            VALUES (
              ${episodeId}::uuid,
              ${recordUserId},
              ${content},
              ${`[${vector.join(",")}]`}::vector,
              ${labelIds}::text[],
              ${sessionId},
              ${ingestionQueueId},
              NOW(),
              NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET vector = EXCLUDED.vector,
                content = EXCLUDED.content,
                "labelIds" = EXCLUDED."labelIds",
                "ingestionQueueId" = EXCLUDED."ingestionQueueId",
                "sessionId" = EXCLUDED."sessionId",
                "updatedAt" = NOW()
          `;

            totalMigrated++;
          }
        },
        {
          maxWait: 30000,
          timeout: 120000,
        },
      );

      logger.info(
        `Successfully migrated batch of ${batch.length} episode embeddings`,
      );
    } catch (error: any) {
      console.log(error);
      const errorMsg = `Error migrating episode embeddings batch ${skip / batchSize + 1}: ${error.message}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return { migrated: totalMigrated, errors };
}

/**
 * Migrate entity embeddings from Neo4j to pgvector
 */
async function migrateEntityEmbeddings(
  userId: string | undefined,
  batchSize: number,
  dryRun: boolean,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = [];
  let totalMigrated = 0;

  logger.info("Starting entity embeddings migration", { userId, dryRun });

  // First, count total records to migrate
  const countQuery = `
    ${userId ? "MATCH (e:Entity {userId: $userId})" : "MATCH (e:Entity)"}
    WHERE e.nameEmbedding IS NOT NULL AND size(e.nameEmbedding) > 0
    RETURN count(e) as total
  `;

  const countParams = userId ? { userId } : {};
  const countResult = await runQuery(countQuery, countParams);
  const totalRecords = countResult[0]?.get("total")?.toNumber() || 0;

  logger.info(`Found ${totalRecords} entities with embeddings in Neo4j`);

  if (totalRecords === 0) {
    return { migrated: 0, errors };
  }

  // Process in batches using SKIP/LIMIT to avoid loading all into memory
  for (let skip = 0; skip < totalRecords; skip += batchSize) {
    const query = `
      ${userId ? "MATCH (e:Entity {userId: $userId})" : "MATCH (e:Entity)"}
      WHERE e.nameEmbedding IS NOT NULL AND size(e.nameEmbedding) > 0
      RETURN e.uuid as entityId,
             e.userId as userId,
             e.name as name,
             e.nameEmbedding as vector
      ORDER BY e.createdAt
      SKIP ${skip}
      LIMIT ${batchSize}
    `;

    const params = {
      ...(userId ? { userId } : {}),
    };

    const result = await runQuery(query, params);
    const batch = result;

    logger.info(`Processing entities batch ${skip / batchSize + 1}`, {
      start: skip,
      end: Math.min(skip + batchSize, totalRecords),
      total: totalRecords,
    });

    if (dryRun) {
      logger.info(`[DRY RUN] Would migrate ${batch.length} entity embeddings`);
      totalMigrated += batch.length;
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const record of batch) {
            const entityId = record.get("entityId");
            const recordUserId = record.get("userId");
            const name = record.get("name");
            const vector = record.get("vector");

            await tx.$executeRaw`
            INSERT INTO core.entity_embeddings (id, "userId", name, vector, "createdAt", "updatedAt")
            VALUES (
              ${entityId}::uuid,
              ${recordUserId},
              ${name},
              ${`[${vector.join(",")}]`}::vector,
              NOW(),
              NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET vector = EXCLUDED.vector,
                name = EXCLUDED.name,
                "updatedAt" = NOW()
          `;

            totalMigrated++;
          }
        },
        {
          maxWait: 30000,
          timeout: 120000,
        },
      );

      logger.info(
        `Successfully migrated batch of ${batch.length} entity embeddings`,
      );
    } catch (error: any) {
      const errorMsg = `Error migrating entity embeddings batch ${skip / batchSize + 1}: ${error.message}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return { migrated: totalMigrated, errors };
}

/**
 * Migrate compacted session embeddings from Neo4j to pgvector
 */
async function migrateCompactedSessionEmbeddings(
  userId: string | undefined,
  batchSize: number,
  dryRun: boolean,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = [];
  let totalMigrated = 0;

  logger.info("Starting compacted session embeddings migration", {
    userId,
    dryRun,
  });

  // First, count total records to migrate
  const countQuery = `
    ${userId ? "MATCH (cs:CompactedSession {userId: $userId})" : "MATCH (cs:CompactedSession)"}
    WHERE cs.summaryEmbedding IS NOT NULL AND size(cs.summaryEmbedding) > 0
    RETURN count(cs) as total
  `;

  const countParams = userId ? { userId } : {};
  const countResult = await runQuery(countQuery, countParams);
  const totalRecords = countResult[0]?.get("total")?.toNumber() || 0;

  logger.info(`Found ${totalRecords} compacted session embeddings to migrate`);

  if (totalRecords === 0) {
    return { migrated: 0, errors };
  }

  // Process in batches using SKIP/LIMIT to avoid loading all into memory
  for (let skip = 0; skip < totalRecords; skip += batchSize) {
    const query = `
      ${userId ? "MATCH (cs:CompactedSession {userId: $userId})" : "MATCH (cs:CompactedSession)"}
      WHERE cs.summaryEmbedding IS NOT NULL AND size(cs.summaryEmbedding) > 0
      RETURN cs.uuid as compactedSessionId,
             cs.userId as userId,
             cs.summary as summary,
             cs.summaryEmbedding as vector,
             cs.metadata as metadata
      ORDER BY cs.createdAt
      SKIP ${skip}
      LIMIT ${batchSize}
    `;

    const params = {
      ...(userId ? { userId } : {}),
    };

    const result = await runQuery(query, params);
    const batch = result;

    if (dryRun) {
      logger.info(
        `[DRY RUN] Would migrate batch of ${batch.length} compacted session embeddings`,
      );
      totalMigrated += batch.length;
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const record of batch) {
            const compactedSessionId = record.get("compactedSessionId");
            const recordUserId = record.get("userId");
            const summary = record.get("summary");
            const vector = record.get("vector");
            const metadata = record.get("metadata");

            await tx.$executeRaw`
            INSERT INTO core.compacted_session_embeddings (id, "userId", summary, vector, metadata, "createdAt", "updatedAt")
            VALUES (
              ${compactedSessionId}::uuid,
              ${recordUserId},
              ${summary},
              ${`[${vector.join(",")}]`}::vector,
              ${metadata ? JSON.parse(metadata) : null}::jsonb,
              NOW(),
              NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET vector = EXCLUDED.vector,
                summary = EXCLUDED.summary,
                metadata = EXCLUDED.metadata,
                "updatedAt" = NOW()
          `;

            totalMigrated++;
          }
        },
        {
          maxWait: 30000,
          timeout: 120000,
        },
      );

      logger.info(
        `Successfully migrated batch of ${batch.length} compacted session embeddings`,
      );
    } catch (error: any) {
      const errorMsg = `Error migrating compacted session embeddings batch ${skip / batchSize + 1}: ${error.message}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return { migrated: totalMigrated, errors };
}

const migrationQueue = queue({
  name: "embeddings-migration-queue",
  concurrencyLimit: 20,
});

/**
 * Main migration task
 *
 * Usage:
 *   await migrateEmbeddingsTask.trigger({});  // Migrate all embeddings
 *   await migrateEmbeddingsTask.trigger({ userId: "user123" });  // Specific user
 *   await migrateEmbeddingsTask.trigger({ dryRun: true });  // Preview migration
 *   await migrateEmbeddingsTask.trigger({ skipStatements: true });  // Skip statements
 */
export const migrateEmbeddingsTask = task({
  id: "migrate-embeddings-neo4j-to-pgvector",
  machine: "medium-1x",
  retry: {
    maxAttempts: 1,
  },
  queue: migrationQueue,
  run: async (
    payload: MigrateEmbeddingsPayload = {},
  ): Promise<MigrateEmbeddingsResult> => {
    // Initialize ProviderFactory for Neo4j and vector providers
    await initializeProvider();

    const batchSize = payload.batchSize || 2000;
    const dryRun = payload.dryRun || false;

    logger.info("Starting embeddings migration from Neo4j to pgvector", {
      userId: payload.userId || "all",
      batchSize,
      dryRun,
      skipStatements: payload.skipStatements,
      skipEpisodes: payload.skipEpisodes,
      skipEntities: payload.skipEntities,
      skipCompactedSessions: payload.skipCompactedSessions,
    });

    const result: MigrateEmbeddingsResult = {
      success: true,
      statementsMigrated: 0,
      episodesMigrated: 0,
      entitiesMigrated: 0,
      compactedSessionsMigrated: 0,
      errors: [],
    };

    try {
      // Migrate statements
      if (!payload.skipStatements) {
        const statementResult = await migrateStatementEmbeddings(
          payload.userId,
          batchSize,
          dryRun,
        );
        result.statementsMigrated = statementResult.migrated;
        result.errors.push(...statementResult.errors);
        logger.info(`Completed statement embeddings migration`, {
          migrated: statementResult.migrated,
          errors: statementResult.errors.length,
        });
      }

      // Migrate episodes
      if (!payload.skipEpisodes) {
        const episodeResult = await migrateEpisodeEmbeddings(
          payload.userId,
          batchSize,
          dryRun,
        );
        result.episodesMigrated = episodeResult.migrated;
        result.errors.push(...episodeResult.errors);
        logger.info(`Completed episode embeddings migration`, {
          migrated: episodeResult.migrated,
          errors: episodeResult.errors.length,
        });
      }

      // Migrate entities
      if (!payload.skipEntities) {
        const entityResult = await migrateEntityEmbeddings(
          payload.userId,
          batchSize,
          dryRun,
        );
        result.entitiesMigrated = entityResult.migrated;
        result.errors.push(...entityResult.errors);
        logger.info(`Completed entity embeddings migration`, {
          migrated: entityResult.migrated,
          errors: entityResult.errors.length,
        });
      }

      // Migrate compacted sessions
      if (!payload.skipCompactedSessions) {
        const compactedSessionResult = await migrateCompactedSessionEmbeddings(
          payload.userId,
          batchSize,
          dryRun,
        );
        result.compactedSessionsMigrated = compactedSessionResult.migrated;
        result.errors.push(...compactedSessionResult.errors);
        logger.info(`Completed compacted session embeddings migration`, {
          migrated: compactedSessionResult.migrated,
          errors: compactedSessionResult.errors.length,
        });
      }

      if (result.errors.length > 0) {
        result.success = false;
        logger.error(`Migration completed with ${result.errors.length} errors`);
      } else {
        logger.info("Migration completed successfully", {
          statementsMigrated: result.statementsMigrated,
          episodesMigrated: result.episodesMigrated,
          entitiesMigrated: result.entitiesMigrated,
          compactedSessionsMigrated: result.compactedSessionsMigrated,
        });
      }

      return result;
    } catch (error: any) {
      logger.error("Fatal error during embeddings migration", {
        error: error.message,
      });
      result.success = false;
      result.errors.push(error.message);
      return result;
    }
  },
});
