// import { task, logger, queue } from "@trigger.dev/sdk";
// import { runQuery } from "~/lib/neo4j.server";
// import { getEmbedding } from "~/lib/model.server";
// import type { EntityNode, StatementNode, EpisodicNode } from "@core/types";

// interface EntityUpdateResult {
//   uuid: string;
//   name: string;
//   type: string;
//   success: boolean;
//   error?: string;
// }

// interface StatementUpdateResult {
//   uuid: string;
//   fact: string;
//   success: boolean;
//   error?: string;
// }

// interface EpisodeUpdateResult {
//   uuid: string;
//   content: string;
//   success: boolean;
//   error?: string;
// }

// interface EntityBatchResult {
//   batchId: string;
//   entities: number;
//   successful: number;
//   failed: number;
//   results: EntityUpdateResult[];
// }

// interface StatementBatchResult {
//   batchId: string;
//   statements: number;
//   successful: number;
//   failed: number;
//   results: StatementUpdateResult[];
// }

// interface EpisodeBatchResult {
//   batchId: string;
//   episodes: number;
//   successful: number;
//   failed: number;
//   results: EpisodeUpdateResult[];
// }

// export const entity = queue({
//   name: "entity-queue",
//   concurrencyLimit: 1,
// });

// export const statement = queue({
//   name: "statement-queue",
//   concurrencyLimit: 1,
// });

// export const episode = queue({
//   name: "episode-queue",
//   concurrencyLimit: 1,
// });

// /**
//  * Unified orchestrator task that handles entities, statements, and episodes
//  */
// export const updateAllEmbeddings = task({
//   id: "update-all-embeddings",
//   machine: "large-1x",

//   run: async (
//     payload: {
//       userId?: string;
//       batchSize?: number;
//       forceUpdate?: boolean;
//       includeEntities?: boolean;
//       includeStatements?: boolean;
//       includeEpisodes?: boolean;
//     } = {},
//   ) => {
//     const {
//       userId,
//       batchSize = 50,
//       forceUpdate = false,
//       includeEntities = true,
//       includeStatements = true,
//       includeEpisodes = true,
//     } = payload;

//     logger.info("Starting unified embeddings update", {
//       userId,
//       batchSize,
//       forceUpdate,
//       includeEntities,
//       includeStatements,
//       includeEpisodes,
//       targetScope: userId ? `user ${userId}` : "all users",
//     });

//     const results = {
//       entities: { total: 0, batches: 0, batchRunIds: [] },
//       statements: { total: 0, batches: 0, batchRunIds: [] },
//       episodes: { total: 0, batches: 0, batchRunIds: [] },
//     };

//     try {
//       const promises = [];

//       // Trigger entity updates if requested
//       if (includeEntities) {
//         promises.push(
//           updateAllEntityEmbeddings
//             .trigger({
//               userId,
//               batchSize,
//               forceUpdate,
//             })
//             .then((result) => ({ type: "entities", result })),
//         );
//       }

//       // Trigger statement updates if requested
//       if (includeStatements) {
//         promises.push(
//           updateAllStatementEmbeddings
//             .trigger({
//               userId,
//               batchSize,
//               forceUpdate,
//             })
//             .then((result) => ({ type: "statements", result })),
//         );
//       }

//       // Trigger episode updates if requested
//       if (includeEpisodes) {
//         promises.push(
//           updateAllEpisodeEmbeddings
//             .trigger({
//               userId,
//               batchSize,
//               forceUpdate,
//             })
//             .then((result) => ({ type: "episodes", result })),
//         );
//       }

//       // Wait for all orchestrators to start
//       const orchestratorResults = await Promise.allSettled(promises);

//       // Collect results
//       orchestratorResults.forEach((result, index) => {
//         if (result.status === "fulfilled") {
//           const { type, result: orchResult } = result.value;
//           logger.info(`${type} orchestrator started successfully`, {
//             runId: orchResult.id,
//           });
//         } else {
//           logger.error(`Failed to start orchestrator:`, {
//             error: result.reason,
//           });
//         }
//       });

//       return {
//         success: true,
//         message: "All embedding update orchestrators dispatched successfully",
//         results,
//       };
//     } catch (error) {
//       logger.error("Fatal error during unified embeddings update:", { error });
//       throw error;
//     }
//   },
// });

// /**
//  * Main orchestrator task that fans out batches of entities
//  */
// export const updateAllEntityEmbeddings = task({
//   id: "update-all-entity-embeddings",
//   machine: "large-1x",

//   run: async (
//     payload: {
//       userId?: string;
//       batchSize?: number;
//       forceUpdate?: boolean;
//     } = {},
//   ) => {
//     const { userId, batchSize = 50, forceUpdate = false } = payload;

//     logger.info("Starting entity embeddings update with fan-out approach", {
//       userId,
//       batchSize,
//       forceUpdate,
//       targetScope: userId ? `user ${userId}` : "all users",
//     });

//     try {
//       // Step 1: Fetch entities (either all or only those needing updates)
//       const entities = forceUpdate
//         ? await getAllEntitiesForceRefresh(userId)
//         : await getAllEntities(userId);
//       logger.info(`Found ${entities.length} entities to update`, {
//         strategy: forceUpdate ? "force-refresh-all" : "missing-embeddings-only",
//       });

//       if (entities.length === 0) {
//         return {
//           success: true,
//           totalEntities: 0,
//           totalBatches: 0,
//           updated: 0,
//           failed: 0,
//           batchResults: [],
//         };
//       }

//       // Step 2: Split entities into batches and fan out
//       const batches: EntityNode[][] = [];
//       for (let i = 0; i < entities.length; i += batchSize) {
//         batches.push(entities.slice(i, i + batchSize));
//       }

//       logger.info(
//         `Fanning out ${batches.length} batches of ~${batchSize} entities each`,
//       );

//       // Step 3: Fan out batch processing tasks in parallel
//       const batchPromises = batches.map((batch, index) =>
//         updateEntityBatch.trigger({
//           entities: batch,
//           batchId: `batch-${index + 1}`,
//           batchNumber: index + 1,
//           totalBatches: batches.length,
//         }),
//       );

//       // Wait for all batch tasks to complete
//       const batchRuns = await Promise.all(batchPromises);

//       // Step 4: Collect results from all batches
//       const batchResults: EntityBatchResult[] = [];
//       let totalUpdated = 0;
//       let totalFailed = 0;

//       for (const run of batchRuns) {
//         try {
//           // Note: In a real implementation, you'd need to wait for the run to complete
//           // and fetch its result. This is a simplified version.
//           logger.info(`Batch run ${run.id} started successfully`);
//         } catch (error) {
//           logger.error(`Failed to start batch run:`, { error });
//         }
//       }

//       logger.info("All batches have been dispatched", {
//         totalBatches: batches.length,
//         totalEntities: entities.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//       });

//       return {
//         success: true,
//         totalEntities: entities.length,
//         totalBatches: batches.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//         message:
//           "All batches dispatched successfully. Check individual batch runs for detailed results.",
//       };
//     } catch (error) {
//       logger.error(
//         "Fatal error during entity embeddings update orchestration:",
//         { error },
//       );
//       throw error;
//     }
//   },
// });

// /**
//  * Worker task that processes a single batch of entities
//  */
// export const updateEntityBatch = task({
//   id: "update-entity-batch",
//   queue: entity,
//   run: async (payload: {
//     entities: EntityNode[];
//     batchId: string;
//     batchNumber: number;
//     totalBatches: number;
//   }) => {
//     const { entities, batchId, batchNumber, totalBatches } = payload;

//     logger.info(`Processing ${batchId} (${batchNumber}/${totalBatches})`, {
//       entityCount: entities.length,
//     });

//     const results: EntityUpdateResult[] = [];

//     try {
//       // Process all entities in this batch in parallel
//       const entityPromises = entities.map((entity) =>
//         updateEntityEmbeddings(entity),
//       );
//       const entityResults = await Promise.allSettled(entityPromises);

//       // Collect results
//       entityResults.forEach((result, index) => {
//         const entity = entities[index];
//         if (result.status === "fulfilled") {
//           results.push(result.value);
//         } else {
//           logger.error(
//             `Failed to update entity ${entity.uuid} in ${batchId}:`,
//             { error: result.reason },
//           );
//           results.push({
//             uuid: entity.uuid,
//             name: entity.name,
//             type: entity.type,
//             success: false,
//             error: result.reason?.message || "Unknown error",
//           });
//         }
//       });

//       const successful = results.filter((r) => r.success).length;
//       const failed = results.filter((r) => !r.success).length;

//       logger.info(`Completed ${batchId}`, {
//         total: entities.length,
//         successful,
//         failed,
//         successRate: `${((successful / entities.length) * 100).toFixed(2)}%`,
//       });

//       return {
//         batchId,
//         batchNumber,
//         totalBatches,
//         entities: entities.length,
//         successful,
//         failed,
//         results,
//       };
//     } catch (error) {
//       logger.error(`Fatal error in ${batchId}:`, { error });
//       throw error;
//     }
//   },
// });

// /**
//  * Main orchestrator task that fans out batches of statements
//  */
// export const updateAllStatementEmbeddings = task({
//   id: "update-all-statement-embeddings",
//   machine: "large-1x",

//   run: async (
//     payload: {
//       userId?: string;
//       batchSize?: number;
//       forceUpdate?: boolean;
//     } = {},
//   ) => {
//     const { userId, batchSize = 50, forceUpdate = false } = payload;

//     logger.info("Starting statement embeddings update", {
//       userId,
//       batchSize,
//       forceUpdate,
//       targetScope: userId ? `user ${userId}` : "all users",
//     });

//     try {
//       // Fetch statements
//       const statements = forceUpdate
//         ? await getAllStatementsForceRefresh(userId)
//         : await getAllStatements(userId);

//       logger.info(`Found ${statements.length} statements to update`);

//       if (statements.length === 0) {
//         return {
//           success: true,
//           totalStatements: 0,
//           totalBatches: 0,
//           batchRunIds: [],
//         };
//       }

//       // Split into batches
//       const batches: StatementNode[][] = [];
//       for (let i = 0; i < statements.length; i += batchSize) {
//         batches.push(statements.slice(i, i + batchSize));
//       }

//       // Fan out batch processing
//       const batchPromises = batches.map((batch, index) =>
//         updateStatementBatch.trigger({
//           statements: batch,
//           batchId: `statement-batch-${index + 1}`,
//           batchNumber: index + 1,
//           totalBatches: batches.length,
//         }),
//       );

//       const batchRuns = await Promise.all(batchPromises);

//       logger.info("All statement batches dispatched", {
//         totalBatches: batches.length,
//         totalStatements: statements.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//       });

//       return {
//         success: true,
//         totalStatements: statements.length,
//         totalBatches: batches.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//       };
//     } catch (error) {
//       logger.error("Fatal error during statement embeddings update:", {
//         error,
//       });
//       throw error;
//     }
//   },
// });

// /**
//  * Main orchestrator task that fans out batches of episodes
//  */
// export const updateAllEpisodeEmbeddings = task({
//   id: "update-all-episode-embeddings",
//   machine: "large-1x",

//   run: async (
//     payload: {
//       userId?: string;
//       batchSize?: number;
//       forceUpdate?: boolean;
//     } = {},
//   ) => {
//     const { userId, batchSize = 30, forceUpdate = false } = payload;

//     logger.info("Starting episode embeddings update", {
//       userId,
//       batchSize,
//       forceUpdate,
//       targetScope: userId ? `user ${userId}` : "all users",
//     });

//     try {
//       // Fetch episodes
//       const episodes = forceUpdate
//         ? await getAllEpisodesForceRefresh(userId)
//         : await getAllEpisodes(userId);

//       logger.info(`Found ${episodes.length} episodes to update`);

//       if (episodes.length === 0) {
//         return {
//           success: true,
//           totalEpisodes: 0,
//           totalBatches: 0,
//           batchRunIds: [],
//         };
//       }

//       // Split into batches (smaller batches for episodes due to larger content)
//       const batches: EpisodicNode[][] = [];
//       for (let i = 0; i < episodes.length; i += batchSize) {
//         batches.push(episodes.slice(i, i + batchSize));
//       }

//       // Fan out batch processing
//       const batchPromises = batches.map((batch, index) =>
//         updateEpisodeBatch.trigger({
//           episodes: batch,
//           batchId: `episode-batch-${index + 1}`,
//           batchNumber: index + 1,
//           totalBatches: batches.length,
//         }),
//       );

//       const batchRuns = await Promise.all(batchPromises);

//       logger.info("All episode batches dispatched", {
//         totalBatches: batches.length,
//         totalEpisodes: episodes.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//       });

//       return {
//         success: true,
//         totalEpisodes: episodes.length,
//         totalBatches: batches.length,
//         batchRunIds: batchRuns.map((r) => r.id),
//       };
//     } catch (error) {
//       logger.error("Fatal error during episode embeddings update:", { error });
//       throw error;
//     }
//   },
// });

// /**
//  * Worker task that processes a single batch of statements
//  */
// export const updateStatementBatch = task({
//   id: "update-statement-batch",
//   queue: statement,
//   run: async (payload: {
//     statements: StatementNode[];
//     batchId: string;
//     batchNumber: number;
//     totalBatches: number;
//   }) => {
//     const { statements, batchId, batchNumber, totalBatches } = payload;

//     logger.info(`Processing ${batchId} (${batchNumber}/${totalBatches})`, {
//       statementCount: statements.length,
//     });

//     const results: StatementUpdateResult[] = [];

//     try {
//       // Process all statements in this batch in parallel
//       const statementPromises = statements.map((statement) =>
//         updateStatementEmbeddings(statement),
//       );
//       const statementResults = await Promise.allSettled(statementPromises);

//       // Collect results
//       statementResults.forEach((result, index) => {
//         const statement = statements[index];
//         if (result.status === "fulfilled") {
//           results.push(result.value);
//         } else {
//           logger.error(
//             `Failed to update statement ${statement.uuid} in ${batchId}:`,
//             { error: result.reason },
//           );
//           results.push({
//             uuid: statement.uuid,
//             fact: statement.fact,
//             success: false,
//             error: result.reason?.message || "Unknown error",
//           });
//         }
//       });

//       const successful = results.filter((r) => r.success).length;
//       const failed = results.filter((r) => !r.success).length;

//       logger.info(`Completed ${batchId}`, {
//         total: statements.length,
//         successful,
//         failed,
//         successRate: `${((successful / statements.length) * 100).toFixed(2)}%`,
//       });

//       return {
//         batchId,
//         batchNumber,
//         totalBatches,
//         statements: statements.length,
//         successful,
//         failed,
//         results,
//       };
//     } catch (error) {
//       logger.error(`Fatal error in ${batchId}:`, { error });
//       throw error;
//     }
//   },
// });

// /**
//  * Worker task that processes a single batch of episodes
//  */
// export const updateEpisodeBatch = task({
//   id: "update-episode-batch",
//   queue: episode,
//   run: async (payload: {
//     episodes: EpisodicNode[];
//     batchId: string;
//     batchNumber: number;
//     totalBatches: number;
//   }) => {
//     const { episodes, batchId, batchNumber, totalBatches } = payload;

//     logger.info(`Processing ${batchId} (${batchNumber}/${totalBatches})`, {
//       episodeCount: episodes.length,
//     });

//     const results: EpisodeUpdateResult[] = [];

//     try {
//       // Process all episodes in this batch in parallel
//       const episodePromises = episodes.map((episode) =>
//         updateEpisodeEmbeddings(episode),
//       );
//       const episodeResults = await Promise.allSettled(episodePromises);

//       // Collect results
//       episodeResults.forEach((result, index) => {
//         const episode = episodes[index];
//         if (result.status === "fulfilled") {
//           results.push(result.value);
//         } else {
//           logger.error(
//             `Failed to update episode ${episode.uuid} in ${batchId}:`,
//             { error: result.reason },
//           );
//           results.push({
//             uuid: episode.uuid,
//             content: episode.content,
//             success: false,
//             error: result.reason?.message || "Unknown error",
//           });
//         }
//       });

//       const successful = results.filter((r) => r.success).length;
//       const failed = results.filter((r) => !r.success).length;

//       logger.info(`Completed ${batchId}`, {
//         total: episodes.length,
//         successful,
//         failed,
//         successRate: `${((successful / episodes.length) * 100).toFixed(2)}%`,
//       });

//       return {
//         batchId,
//         batchNumber,
//         totalBatches,
//         episodes: episodes.length,
//         successful,
//         failed,
//         results,
//       };
//     } catch (error) {
//       logger.error(`Fatal error in ${batchId}:`, { error });
//       throw error;
//     }
//   },
// });

// /**
//  * Fetch all entities from Neo4j database that need embedding updates
//  */
// async function getAllEntities(userId?: string): Promise<EntityNode[]> {
//   try {
//     // Only fetch entities that either:
//     // 1. Have null/empty embeddings, OR
//     // 2. Have embeddings but might need updates (optional: add timestamp check)
//     const query = userId
//       ? `MATCH (entity:Entity {userId: $userId})
//          WHERE entity.nameEmbedding IS NULL
//             OR entity.typeEmbedding IS NULL
//             OR size(entity.nameEmbedding) = 0
//             OR size(entity.typeEmbedding) = 0
//          RETURN entity ORDER BY entity.createdAt`
//       : `MATCH (entity:Entity)
//          WHERE entity.nameEmbedding IS NULL
//             OR entity.typeEmbedding IS NULL
//             OR size(entity.nameEmbedding) = 0
//             OR size(entity.typeEmbedding) = 0
//          RETURN entity ORDER BY entity.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const entityProps = record.get("entity").properties;
//       return {
//         uuid: entityProps.uuid,
//         name: entityProps.name,
//         type: entityProps.type,
//         attributes: JSON.parse(entityProps.attributes || "{}"),
//         nameEmbedding: entityProps.nameEmbedding || [],
//         typeEmbedding: entityProps.typeEmbedding || [],
//         createdAt: new Date(entityProps.createdAt),
//         userId: entityProps.userId,
//         space: entityProps.space,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching entities:", { error });
//     throw new Error(`Failed to fetch entities: ${error}`);
//   }
// }

// /**
//  * Fetch ALL entities from Neo4j database (for force refresh)
//  */
// async function getAllEntitiesForceRefresh(
//   userId?: string,
// ): Promise<EntityNode[]> {
//   try {
//     const query = userId
//       ? `MATCH (entity:Entity {userId: $userId}) RETURN entity ORDER BY entity.createdAt`
//       : `MATCH (entity:Entity) RETURN entity ORDER BY entity.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const entityProps = record.get("entity").properties;
//       return {
//         uuid: entityProps.uuid,
//         name: entityProps.name,
//         type: entityProps.type,
//         attributes: JSON.parse(entityProps.attributes || "{}"),
//         nameEmbedding: entityProps.nameEmbedding || [],
//         typeEmbedding: entityProps.typeEmbedding || [],
//         createdAt: new Date(entityProps.createdAt),
//         userId: entityProps.userId,
//         space: entityProps.space,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching entities:", { error });
//     throw new Error(`Failed to fetch entities: ${error}`);
//   }
// }

// /**
//  * Update embeddings for a single entity
//  */
// async function updateEntityEmbeddings(
//   entity: EntityNode,
// ): Promise<EntityUpdateResult> {
//   try {
//     logger.info(
//       `Updating embeddings for entity: ${entity.name} (${entity.type})`,
//     );

//     // Generate new embeddings
//     const [nameEmbedding, typeEmbedding] = await Promise.all([
//       getEmbedding(entity.name),
//       getEmbedding(entity.type),
//     ]);

//     // Update entity in Neo4j
//     const updateQuery = `
//       MATCH (entity:Entity {uuid: $uuid})
//       SET
//         entity.nameEmbedding = $nameEmbedding,
//         entity.typeEmbedding = $typeEmbedding,
//         entity.updatedAt = $updatedAt
//       RETURN entity.uuid as uuid
//     `;

//     const updateParams = {
//       uuid: entity.uuid,
//       nameEmbedding,
//       typeEmbedding,
//       updatedAt: new Date().toISOString(),
//     };

//     const result = await runQuery(updateQuery, updateParams);

//     if (result.length === 0) {
//       throw new Error(`Entity ${entity.uuid} not found during update`);
//     }

//     return {
//       uuid: entity.uuid,
//       name: entity.name,
//       type: entity.type,
//       success: true,
//     };
//   } catch (error) {
//     return {
//       uuid: entity.uuid,
//       name: entity.name,
//       type: entity.type,
//       success: false,
//       error: error instanceof Error ? error.message : "Unknown error", // TODO: fix this
//     };
//   }
// }

// /**
//  * Helper function to trigger the entity embeddings update
//  */
// export async function triggerEntityEmbeddingsUpdate(
//   options: {
//     userId?: string;
//     batchSize?: number;
//     forceUpdate?: boolean;
//   } = {},
// ) {
//   try {
//     const result = await updateAllEntityEmbeddings.trigger(options);
//     logger.info(`Triggered entity embeddings update with run ID: ${result.id}`);
//     return result;
//   } catch (error) {
//     logger.error("Failed to trigger entity embeddings update:", { error });
//     throw error;
//   }
// }

// /**
//  * Update a single entity's embeddings (useful for individual updates)
//  */
// export async function updateSingleEntityEmbeddings(
//   entityUuid: string,
// ): Promise<EntityUpdateResult> {
//   try {
//     const query = `MATCH (entity:Entity {uuid: $uuid}) RETURN entity`;
//     const records = await runQuery(query, { uuid: entityUuid });

//     if (records.length === 0) {
//       throw new Error(`Entity with UUID ${entityUuid} not found`);
//     }

//     const entityProps = records[0].get("entity").properties;
//     const entity: EntityNode = {
//       uuid: entityProps.uuid,
//       name: entityProps.name,
//       type: entityProps.type,
//       attributes: JSON.parse(entityProps.attributes || "{}"),
//       nameEmbedding: entityProps.nameEmbedding || [],
//       typeEmbedding: entityProps.typeEmbedding || [],
//       createdAt: new Date(entityProps.createdAt),
//       userId: entityProps.userId,
//       space: entityProps.space,
//     };

//     return await updateEntityEmbeddings(entity);
//   } catch (error) {
//     logger.error(`Error updating single entity ${entityUuid}:`, { error });
//     throw error;
//   }
// }

// /**
//  * Helper function to trigger unified embeddings update for all types
//  */
// export async function triggerUnifiedEmbeddingsUpdate(
//   options: {
//     userId?: string;
//     batchSize?: number;
//     forceUpdate?: boolean;
//     includeEntities?: boolean;
//     includeStatements?: boolean;
//     includeEpisodes?: boolean;
//   } = {},
// ) {
//   try {
//     const result = await updateAllEmbeddings.trigger(options);
//     logger.info(
//       `Triggered unified embeddings update with run ID: ${result.id}`,
//     );
//     return result;
//   } catch (error) {
//     logger.error("Failed to trigger unified embeddings update:", { error });
//     throw error;
//   }
// }

// /**
//  * Helper function to trigger statement embeddings update
//  */
// export async function triggerStatementEmbeddingsUpdate(
//   options: {
//     userId?: string;
//     batchSize?: number;
//     forceUpdate?: boolean;
//   } = {},
// ) {
//   try {
//     const result = await updateAllStatementEmbeddings.trigger(options);
//     logger.info(
//       `Triggered statement embeddings update with run ID: ${result.id}`,
//     );
//     return result;
//   } catch (error) {
//     logger.error("Failed to trigger statement embeddings update:", { error });
//     throw error;
//   }
// }

// /**
//  * Helper function to trigger episode embeddings update
//  */
// export async function triggerEpisodeEmbeddingsUpdate(
//   options: {
//     userId?: string;
//     batchSize?: number;
//     forceUpdate?: boolean;
//   } = {},
// ) {
//   try {
//     const result = await updateAllEpisodeEmbeddings.trigger(options);
//     logger.info(
//       `Triggered episode embeddings update with run ID: ${result.id}`,
//     );
//     return result;
//   } catch (error) {
//     logger.error("Failed to trigger episode embeddings update:", { error });
//     throw error;
//   }
// }

// /**
//  * Update a single statement's embeddings
//  */
// export async function updateSingleStatementEmbeddings(
//   statementUuid: string,
// ): Promise<StatementUpdateResult> {
//   try {
//     const query = `MATCH (statement:Statement {uuid: $uuid}) RETURN statement`;
//     const records = await runQuery(query, { uuid: statementUuid });

//     if (records.length === 0) {
//       throw new Error(`Statement with UUID ${statementUuid} not found`);
//     }

//     const statementProps = records[0].get("statement").properties;
//     const statement: StatementNode = {
//       uuid: statementProps.uuid,
//       fact: statementProps.fact,
//       factEmbedding: statementProps.factEmbedding || [],
//       createdAt: new Date(statementProps.createdAt),
//       validAt: new Date(statementProps.validAt),
//       invalidAt: statementProps.invalidAt
//         ? new Date(statementProps.invalidAt)
//         : null,
//       attributes: JSON.parse(statementProps.attributes || "{}"),
//       userId: statementProps.userId,
//       space: statementProps.space,
//       recallCount: statementProps.recallCount || 0,
//       provenanceCount: statementProps.provenanceCount || 0,
//     };

//     return await updateStatementEmbeddings(statement);
//   } catch (error) {
//     logger.error(`Error updating single statement ${statementUuid}:`, {
//       error,
//     });
//     throw error;
//   }
// }

// /**
//  * Update a single episode's embeddings
//  */
// export async function updateSingleEpisodeEmbeddings(
//   episodeUuid: string,
// ): Promise<EpisodeUpdateResult> {
//   try {
//     const query = `MATCH (episode:Episode {uuid: $uuid}) RETURN episode`;
//     const records = await runQuery(query, { uuid: episodeUuid });

//     if (records.length === 0) {
//       throw new Error(`Episode with UUID ${episodeUuid} not found`);
//     }

//     const episodeProps = records[0].get("episode").properties;
//     const episode: EpisodicNode = {
//       uuid: episodeProps.uuid,
//       content: episodeProps.content,
//       originalContent: episodeProps.originalContent,
//       contentEmbedding: episodeProps.contentEmbedding || [],
//       metadata: JSON.parse(episodeProps.metadata || "{}"),
//       source: episodeProps.source,
//       createdAt: new Date(episodeProps.createdAt),
//       validAt: new Date(episodeProps.validAt),
//       labels: episodeProps.labels || [],
//       userId: episodeProps.userId,
//       space: episodeProps.space,
//       sessionId: episodeProps.sessionId,
//       recallCount: episodeProps.recallCount || 0,
//     };

//     return await updateEpisodeEmbeddings(episode);
//   } catch (error) {
//     logger.error(`Error updating single episode ${episodeUuid}:`, { error });
//     throw error;
//   }
// }

// /**
//  * Fetch all statements from Neo4j database that need embedding updates
//  */
// async function getAllStatements(userId?: string): Promise<StatementNode[]> {
//   try {
//     const query = userId
//       ? `MATCH (statement:Statement {userId: $userId})
//          WHERE statement.factEmbedding IS NULL
//             OR size(statement.factEmbedding) = 0
//          RETURN statement ORDER BY statement.createdAt`
//       : `MATCH (statement:Statement)
//          WHERE statement.factEmbedding IS NULL
//             OR size(statement.factEmbedding) = 0
//          RETURN statement ORDER BY statement.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const statementProps = record.get("statement").properties;
//       return {
//         uuid: statementProps.uuid,
//         fact: statementProps.fact,
//         factEmbedding: statementProps.factEmbedding || [],
//         createdAt: new Date(statementProps.createdAt),
//         validAt: new Date(statementProps.validAt),
//         invalidAt: statementProps.invalidAt
//           ? new Date(statementProps.invalidAt)
//           : null,
//         attributes: JSON.parse(statementProps.attributes || "{}"),
//         userId: statementProps.userId,
//         space: statementProps.space,
//         recallCount: statementProps.recallCount || 0,
//         provenanceCount: statementProps.provenanceCount || 0,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching statements:", { error });
//     throw new Error(`Failed to fetch statements: ${error}`);
//   }
// }

// /**
//  * Fetch ALL statements from Neo4j database (for force refresh)
//  */
// async function getAllStatementsForceRefresh(
//   userId?: string,
// ): Promise<StatementNode[]> {
//   try {
//     const query = userId
//       ? `MATCH (statement:Statement {userId: $userId}) RETURN statement ORDER BY statement.createdAt`
//       : `MATCH (statement:Statement) RETURN statement ORDER BY statement.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const statementProps = record.get("statement").properties;
//       return {
//         uuid: statementProps.uuid,
//         fact: statementProps.fact,
//         factEmbedding: [],
//         createdAt: new Date(statementProps.createdAt),
//         validAt: new Date(statementProps.validAt),
//         invalidAt: statementProps.invalidAt
//           ? new Date(statementProps.invalidAt)
//           : null,
//         attributes: JSON.parse(statementProps.attributes || "{}"),
//         userId: statementProps.userId,
//         space: statementProps.space,
//         recallCount: statementProps.recallCount || 0,
//         provenanceCount: statementProps.provenanceCount || 0,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching statements:", { error });
//     throw new Error(`Failed to fetch statements: ${error}`);
//   }
// }

// /**
//  * Fetch all episodes from Neo4j database that need embedding updates
//  */
// async function getAllEpisodes(userId?: string): Promise<EpisodicNode[]> {
//   try {
//     const query = userId
//       ? `MATCH (episode:Episode {userId: $userId})
//          WHERE episode.contentEmbedding IS NULL
//             OR size(episode.contentEmbedding) = 0
//          RETURN episode ORDER BY episode.createdAt`
//       : `MATCH (episode:Episode)
//          WHERE episode.contentEmbedding IS NULL
//             OR size(episode.contentEmbedding) = 0
//          RETURN episode ORDER BY episode.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const episodeProps = record.get("episode").properties;
//       return {
//         uuid: episodeProps.uuid,
//         content: episodeProps.content,
//         originalContent: episodeProps.originalContent,
//         contentEmbedding: episodeProps.contentEmbedding || [],
//         metadata: JSON.parse(episodeProps.metadata || "{}"),
//         source: episodeProps.source,
//         createdAt: new Date(episodeProps.createdAt),
//         validAt: new Date(episodeProps.validAt),
//         labels: episodeProps.labels || [],
//         userId: episodeProps.userId,
//         space: episodeProps.space,
//         sessionId: episodeProps.sessionId,
//         recallCount: episodeProps.recallCount || 0,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching episodes:", { error });
//     throw new Error(`Failed to fetch episodes: ${error}`);
//   }
// }

// /**
//  * Fetch ALL episodes from Neo4j database (for force refresh)
//  */
// async function getAllEpisodesForceRefresh(
//   userId?: string,
// ): Promise<EpisodicNode[]> {
//   try {
//     const query = userId
//       ? `MATCH (episode:Episode {userId: $userId}) RETURN episode ORDER BY episode.createdAt`
//       : `MATCH (episode:Episode) RETURN episode ORDER BY episode.createdAt`;

//     const params = userId ? { userId } : {};
//     const records = await runQuery(query, params);

//     return records.map((record) => {
//       const episodeProps = record.get("episode").properties;
//       return {
//         uuid: episodeProps.uuid,
//         content: episodeProps.content,
//         originalContent: episodeProps.originalContent,
//         contentEmbedding: episodeProps.contentEmbedding || [],
//         metadata: JSON.parse(episodeProps.metadata || "{}"),
//         source: episodeProps.source,
//         createdAt: new Date(episodeProps.createdAt),
//         validAt: new Date(episodeProps.validAt),
//         labels: episodeProps.labels || [],
//         userId: episodeProps.userId,
//         space: episodeProps.space,
//         sessionId: episodeProps.sessionId,
//         recallCount: episodeProps.recallCount || 0,
//       };
//     });
//   } catch (error) {
//     logger.error("Error fetching episodes:", { error });
//     throw new Error(`Failed to fetch episodes: ${error}`);
//   }
// }

// /**
//  * Update embeddings for a single statement
//  */
// async function updateStatementEmbeddings(
//   statement: StatementNode,
// ): Promise<StatementUpdateResult> {
//   try {
//     logger.info(
//       `Updating embeddings for statement: ${statement.fact.substring(0, 50)}...`,
//     );

//     // Generate new embedding for the fact
//     const factEmbedding = await getEmbedding(statement.fact);

//     // Update statement in Neo4j
//     const updateQuery = `
//       MATCH (statement:Statement {uuid: $uuid})
//       SET
//         statement.factEmbedding = $factEmbedding,
//         statement.updatedAt = $updatedAt
//       RETURN statement.uuid as uuid
//     `;

//     const updateParams = {
//       uuid: statement.uuid,
//       factEmbedding,
//       updatedAt: new Date().toISOString(),
//     };

//     const result = await runQuery(updateQuery, updateParams);

//     if (result.length === 0) {
//       throw new Error(`Statement ${statement.uuid} not found during update`);
//     }

//     return {
//       uuid: statement.uuid,
//       fact: statement.fact,
//       success: true,
//     };
//   } catch (error) {
//     return {
//       uuid: statement.uuid,
//       fact: statement.fact,
//       success: false,
//       error: error instanceof Error ? error.message : "Unknown error",
//     };
//   }
// }

// /**
//  * Update embeddings for a single episode
//  */
// async function updateEpisodeEmbeddings(
//   episode: EpisodicNode,
// ): Promise<EpisodeUpdateResult> {
//   try {
//     logger.info(
//       `Updating embeddings for episode: ${episode.content.substring(0, 50)}...`,
//     );

//     // Generate new embedding for the content
//     const contentEmbedding = await getEmbedding(episode.content);

//     // Update episode in Neo4j
//     const updateQuery = `
//       MATCH (episode:Episode {uuid: $uuid})
//       SET
//         episode.contentEmbedding = $contentEmbedding,
//         episode.updatedAt = $updatedAt
//       RETURN episode.uuid as uuid
//     `;

//     const updateParams = {
//       uuid: episode.uuid,
//       contentEmbedding,
//       updatedAt: new Date().toISOString(),
//     };

//     const result = await runQuery(updateQuery, updateParams);

//     if (result.length === 0) {
//       throw new Error(`Episode ${episode.uuid} not found during update`);
//     }

//     return {
//       uuid: episode.uuid,
//       content: episode.content,
//       success: true,
//     };
//   } catch (error) {
//     return {
//       uuid: episode.uuid,
//       content: episode.content,
//       success: false,
//       error: error instanceof Error ? error.message : "Unknown error",
//     };
//   }
// }
