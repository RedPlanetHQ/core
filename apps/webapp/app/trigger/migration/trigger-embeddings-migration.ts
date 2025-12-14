import { task } from "@trigger.dev/sdk";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";
import {
  migrateEmbeddingsTask,
  type MigrateEmbeddingsPayload,
} from "./migrate-embeddings-neo4j-to-pgvector";

export interface TriggerEmbeddingsMigrationPayload {
  userId?: string; // Trigger migration for specific user, or all users if not provided
  batchSize?: number; // Number of embeddings to process per batch (per user)
  skipStatements?: boolean; // Skip statement embeddings
  skipEpisodes?: boolean; // Skip episode embeddings
  skipEntities?: boolean; // Skip entity embeddings
  skipCompactedSessions?: boolean; // Skip compacted session embeddings
  dryRun?: boolean; // If true, log what would be migrated without writing to pgvector
}

export interface TriggerEmbeddingsMigrationResult {
  success: boolean;
  usersProcessed: number;
  migrationTasksQueued: number;
  errors: string[];
}

/**
 * Get all users from the database or a specific user
 */
async function getUsersToMigrate(userId?: string) {
  const whereClause = userId ? { id: userId } : {};

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      email: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return users;
}

/**
 * Trigger embeddings migration fanout
 *
 * This task queues individual migration tasks for each user.
 * Each user's migration is processed independently via the embeddings-migration-queue.
 *
 * Usage:
 *   await triggerEmbeddingsMigrationTask.trigger({});  // Queue migration for ALL users
 *   await triggerEmbeddingsMigrationTask.trigger({ userId: "user123" });  // Queue for specific user
 *   await triggerEmbeddingsMigrationTask.trigger({ dryRun: true });  // Preview what would be queued
 *   await triggerEmbeddingsMigrationTask.trigger({ skipStatements: true });  // Skip statements for all users
 *   await triggerEmbeddingsMigrationTask.trigger({ batchSize: 1000 });  // Custom batch size per user
 */
export const triggerEmbeddingsMigrationTask = task({
  id: "trigger-embeddings-migration",
  machine: "small-1x",
  retry: {
    maxAttempts: 1,
  },
  run: async (
    payload: TriggerEmbeddingsMigrationPayload = {},
  ): Promise<TriggerEmbeddingsMigrationResult> => {
    const dryRun = payload.dryRun || false;

    logger.info("Starting embeddings migration fanout", {
      userId: payload.userId || "all users",
      batchSize: payload.batchSize || 2000,
      dryRun,
      skipStatements: payload.skipStatements,
      skipEpisodes: payload.skipEpisodes,
      skipEntities: payload.skipEntities,
      skipCompactedSessions: payload.skipCompactedSessions,
    });

    const result: TriggerEmbeddingsMigrationResult = {
      success: true,
      usersProcessed: 0,
      migrationTasksQueued: 0,
      errors: [],
    };

    try {
      // Get users to process
      const users = await getUsersToMigrate(payload.userId);

      if (users.length === 0) {
        logger.info("No users found to process");
        return result;
      }

      logger.info(`Found ${users.length} users to process`);

      // Queue migration task for each user
      for (const user of users) {
        try {
          logger.info(`Queueing migration for user ${user.id}`, {
            email: user.email,
            position: `${result.usersProcessed + 1}/${users.length}`,
          });

          const migrationPayload: MigrateEmbeddingsPayload = {
            userId: user.id,
            batchSize: payload.batchSize,
            skipStatements: payload.skipStatements,
            skipEpisodes: payload.skipEpisodes,
            skipEntities: payload.skipEntities,
            skipCompactedSessions: payload.skipCompactedSessions,
            dryRun,
          };

          if (dryRun) {
            logger.info(
              `[DRY RUN] Would queue embeddings migration for user ${user.id}`,
            );
            result.migrationTasksQueued++;
          } else {
            // Queue the migration task for this user
            const queueResult = await migrateEmbeddingsTask.trigger(
              migrationPayload,
              {
                queue: "embeddings-migration-queue",
                tags: [user.id, "embeddings-migration"],
              },
            );

            result.migrationTasksQueued++;
            logger.info(`Queued embeddings migration for user ${user.id}`, {
              runId: queueResult.id,
            });
          }

          result.usersProcessed++;
        } catch (error: any) {
          const errorMsg = `Error queueing migration for user ${user.id}: ${error.message}`;
          logger.error(errorMsg, { error });
          result.errors.push(errorMsg);
        }
      }

      if (result.errors.length > 0) {
        result.success = false;
        logger.error(
          `Embeddings migration fanout completed with ${result.errors.length} errors`,
          { result },
        );
      } else {
        logger.info("Embeddings migration fanout completed successfully", {
          result,
        });
      }

      return result;
    } catch (error: any) {
      logger.error("Fatal error in embeddings migration fanout", {
        error: error.message,
      });
      result.success = false;
      result.errors.push(error.message);
      return result;
    }
  },
});
