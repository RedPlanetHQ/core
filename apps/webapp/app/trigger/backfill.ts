// //
// import { task } from "@trigger.dev/sdk";
// import { type CoreMessage } from "ai";
// import { logger } from "~/services/logger.service";
// import { runQuery } from "~/lib/neo4j.server";
// import { getEmbedding } from "~/lib/model.server";
// import {
//   findSimilarEntities,
//   mergeEntities,
//   parseEntityNode,
// } from "~/services/graphModels/entity";
// import {
//   ENTITY_NODE_PROPERTIES,
//   STATEMENT_NODE_PROPERTIES,
//   type StatementNode,
//   type EntityNode,
// } from "@core/types";
// import { dedupeNodes } from "~/services/prompts/nodes";
// import { resolveStatementPrompt } from "~/services/prompts/statements";
// import { createBatch, getBatch, type BatchRequest } from "~/lib/batch.server";
// import {
//   findSimilarStatements,
//   deleteStatements,
//   getTripleForStatementsBatch,
//   parseStatementNode,
// } from "~/services/graphModels/statement";
// import { moveAllProvenanceToStatement } from "~/services/graphModels/episode";

// export interface BackfillEmbeddingsPayload {
//   userId?: string;
//   batchSize?: number;
//   skipDeduplication?: boolean;
// }

// export interface BackfillEmbeddingsResult {
//   success: boolean;
//   usersProcessed: number;
//   entitiesProcessed: number;
//   statementsProcessed: number;
//   entitiesDeduplicated: number;
//   statementsDeduplicated: number;
//   errors: string[];
// }

// async function getUsersWithMissingEntityEmbeddings(specificUserId?: string) {
//   const query = `
//     ${specificUserId ? "MATCH (e:Entity {userId: $userId})" : "MATCH (e:Entity)"}
//     WHERE e.nameEmbedding IS NULL OR size(e.nameEmbedding) = 0
//     WITH e.userId AS userId, count(e) AS entityCount
//     RETURN DISTINCT userId, entityCount
//     ORDER BY entityCount DESC
//   `;

//   const result = await runQuery(
//     query,
//     specificUserId ? { userId: specificUserId } : {},
//   );
//   return result.map((record) => ({
//     userId: record.get("userId"),
//     entityCount:
//       record.get("entityCount")?.toNumber?.() || record.get("entityCount") || 0,
//   }));
// }

// async function getUsersWithMissingStatementEmbeddings(specificUserId?: string) {
//   const query = `
//   ${specificUserId ? "MATCH (s:Statement {userId: $userId})" : "MATCH (s:Statement)"}
//   where s.factEmbedding is NOT NULL and size(s.factEmbedding) = 0
//   with s.userId as userId, count(s) as statementCount
//   RETURN DISTINCT userId, statementCount
//   ORDER BY statementCount DESC
//   `;

//   const result = await runQuery(
//     query,
//     specificUserId ? { userId: specificUserId } : {},
//   );
//   return result.map((record) => ({
//     userId: record.get("userId"),
//     statementCount:
//       record.get("statementCount")?.toNumber?.() ||
//       record.get("statementCount") ||
//       0,
//   }));
// }

// async function getEntitiesWithMissingEmbeddings(
//   userId: string,
//   skip: number,
//   limit: number,
// ): Promise<EntityNode[]> {
//   const query = `
//     MATCH (ent:Entity {userId: $userId})
//     WHERE ent.nameEmbedding IS NULL OR size(ent.nameEmbedding) = 0
//     RETURN ${ENTITY_NODE_PROPERTIES} as entity
//     ORDER BY ent.createdAt
//     SKIP ${skip}
//     LIMIT ${limit}
//   `;
//   const result = await runQuery(query, { userId, skip, limit });
//   return result.map((record) => parseEntityNode(record.get("entity")));
// }

// async function getStatementsWithMissingEmbeddings(
//   userId: string,
//   skip: number,
//   limit: number,
// ): Promise<StatementNode[]> {
//   const query = `
//     MATCH (s:Statement {userId: $userId})
//     WHERE s.factEmbedding IS NULL OR size(s.factEmbedding) = 0
//     RETURN ${STATEMENT_NODE_PROPERTIES} as statement
//     ORDER BY s.createdAt
//     SKIP ${skip}
//     LIMIT ${limit}
//   `;
//   const result = await runQuery(query, { userId, skip, limit });
//   return result.map((record) => parseStatementNode(record.get("statement")));
// }

// async function updateEntityEmbedding(uuid: string, embedding: number[]) {
//   await runQuery(
//     `MATCH (e:Entity {uuid: $uuid}) SET e.nameEmbedding = $embedding`,
//     { uuid, embedding },
//   );
// }

// async function updateStatementEmbedding(uuid: string, embedding: number[]) {
//   await runQuery(
//     `MATCH (s:Statement {uuid: $uuid}) SET s.factEmbedding = $embedding`,
//     { uuid, embedding },
//   );
// }

// // Semantic deduplication using embeddings + Batch API
// async function semanticDeduplicateEntities(
//   entities: EntityNode[],
//   userId: string,
//   batchSize: number = 50,
// ): Promise<number> {
//   if (entities.length === 0) return 0;

//   logger.info(`Found ${entities.length} entities for semantic deduplication`);

//   // Find similar entities for each entity
//   const entitiesNeedingResolution: Array<{
//     entity: EntityNode;
//     similarEntities: EntityNode[];
//   }> = [];

//   const processedPairs = new Set<string>();

//   for (const entity of entities) {
//     if (!entity.nameEmbedding || entity.nameEmbedding.length === 0) continue;

//     const similarEntities = await findSimilarEntities({
//       queryEmbedding: entity.nameEmbedding,
//       limit: 5,
//       threshold: 0.7,
//       userId,
//     });

//     // Filter out self and already processed pairs
//     const filteredSimilar = similarEntities.filter((s) => {
//       if (s.uuid === entity.uuid) return false;
//       // Skip if we've already checked this pair
//       const pairKey = [entity.uuid, s.uuid].sort().join("-");
//       if (processedPairs.has(pairKey)) return false;
//       processedPairs.add(pairKey);
//       return true;
//     });

//     if (filteredSimilar.length > 0) {
//       entitiesNeedingResolution.push({
//         entity,
//         similarEntities: filteredSimilar,
//       });
//     }
//   }

//   if (entitiesNeedingResolution.length === 0) {
//     logger.info("No entities need semantic deduplication");
//     return 0;
//   }

//   logger.info(
//     `${entitiesNeedingResolution.length} entities need LLM resolution`,
//   );

//   // Create batch requests for all entities needing resolution
//   const batchRequests: BatchRequest[] = [];
//   const batchIndexMap: Map<string, number> = new Map(); // customId -> index in entitiesNeedingResolution

//   for (let i = 0; i < entitiesNeedingResolution.length; i += batchSize) {
//     const batch = entitiesNeedingResolution.slice(i, i + batchSize);
//     const customId = `dedupe-${userId}-${i}`;

//     const dedupeContext = {
//       extracted_nodes: batch.map((result, index) => ({
//         id: index,
//         name: result.entity.name,
//         duplication_candidates: result.similarEntities.map((candidate, j) => ({
//           idx: j,
//           name: candidate.name,
//           entity_type: candidate.type,
//         })),
//       })),
//       episode_content: "Deduplication task for user entities",
//       previous_episodes: [],
//     };

//     const messages = dedupeNodes(dedupeContext);

//     batchRequests.push({
//       customId,
//       messages: messages as CoreMessage[],
//     });

//     batchIndexMap.set(customId, i);
//   }

//   logger.info(
//     `Creating batch with ${batchRequests.length} requests for user ${userId}`,
//   );

//   // Submit batch
//   const { batchId } = await createBatch({
//     requests: batchRequests,
//     modelComplexity: "low",
//   });

//   logger.info(`Batch created: ${batchId}, polling for results...`);

//   // Poll for batch completion
//   let batchJob = await getBatch({ batchId });
//   const maxWaitTime = 30 * 60 * 1000; // 30 minutes
//   const pollInterval = 10 * 1000; // 10 seconds
//   const startTime = Date.now();

//   while (batchJob.status === "pending" || batchJob.status === "processing") {
//     if (Date.now() - startTime > maxWaitTime) {
//       logger.error(`Batch ${batchId} timed out after 30 minutes`);
//       return 0;
//     }

//     await new Promise((resolve) => setTimeout(resolve, pollInterval));
//     batchJob = await getBatch({ batchId });
//     logger.info(
//       `Batch ${batchId} status: ${batchJob.status}, completed: ${batchJob.completedRequests}/${batchJob.totalRequests}`,
//     );
//   }

//   if (batchJob.status !== "completed") {
//     logger.error(`Batch ${batchId} failed with status: ${batchJob.status}`);
//     return 0;
//   }

//   // Process results and merge entities
//   let totalMergedCount = 0;

//   for (const result of batchJob.results || []) {
//     if (result.error) {
//       logger.error(`Batch request ${result.customId} failed:`, {
//         error: result.error,
//       });
//       continue;
//     }

//     const batchStartIndex = batchIndexMap.get(result.customId);
//     if (batchStartIndex === undefined) continue;

//     const responseText = result.response as string;
//     const outputMatch = responseText?.match(/<output>([\s\S]*?)<\/output>/);

//     if (outputMatch && outputMatch[1]) {
//       try {
//         const parsedResponse = JSON.parse(outputMatch[1].trim());
//         const nodeResolutions = parsedResponse.entity_resolutions || [];

//         for (const resolution of nodeResolutions) {
//           const originalEntity =
//             entitiesNeedingResolution[batchStartIndex + resolution.id];
//           if (!originalEntity) continue;

//           const duplicateIdx = resolution.duplicate_idx ?? -1;

//           if (
//             duplicateIdx >= 0 &&
//             duplicateIdx < originalEntity.similarEntities.length
//           ) {
//             const targetEntity = originalEntity.similarEntities[duplicateIdx];
//             if (targetEntity && targetEntity.uuid) {
//               // Merge source into target
//               await mergeEntities(
//                 originalEntity.entity.uuid,
//                 targetEntity.uuid,
//                 userId,
//               );
//               totalMergedCount++;
//               logger.info(
//                 `Merged "${originalEntity.entity.name}" into "${targetEntity.name}"`,
//               );
//             }
//           }
//         }
//       } catch (error) {
//         logger.error(
//           `Error processing entity resolutions for ${result.customId}:`,
//           { error },
//         );
//       }
//     }
//   }

//   return totalMergedCount;
// }

// // Semantic deduplication for statements using embeddings + Batch API
// async function semanticDeduplicateStatements(
//   statements: StatementNode[],
//   userId: string,
//   batchSize: number = 50,
// ): Promise<number> {
//   if (statements.length === 0) return 0;

//   logger.info(
//     `Found ${statements.length} statements for semantic deduplication`,
//   );

//   // Find similar statements for each statement
//   const statementsNeedingResolution: Array<{
//     statement: StatementNode;
//     similarStatements: Array<{ uuid: string; fact: string }>;
//   }> = [];

//   const processedPairs = new Set<string>();

//   for (const statement of statements) {
//     if (!statement.factEmbedding || statement.factEmbedding.length === 0)
//       continue;

//     const similarStatements = await findSimilarStatements({
//       factEmbedding: statement.factEmbedding,
//       threshold: 0.7,
//       excludeIds: [statement.uuid],
//       userId,
//     });

//     // Filter out already processed pairs
//     const filteredSimilar = similarStatements.filter((s) => {
//       const pairKey = [statement.uuid, s.uuid].sort().join("-");
//       if (processedPairs.has(pairKey)) return false;
//       processedPairs.add(pairKey);
//       return true;
//     });

//     if (filteredSimilar.length > 0) {
//       statementsNeedingResolution.push({
//         statement,
//         similarStatements: filteredSimilar,
//       });
//     }
//   }

//   if (statementsNeedingResolution.length === 0) {
//     logger.info("No statements need semantic deduplication");
//     return 0;
//   }

//   logger.info(
//     `${statementsNeedingResolution.length} statements need LLM resolution`,
//   );

//   // Create batch requests
//   const batchRequests: BatchRequest[] = [];
//   const batchIndexMap: Map<string, number> = new Map();

//   for (let i = 0; i < statementsNeedingResolution.length; i += batchSize) {
//     const batch = statementsNeedingResolution.slice(i, i + batchSize);
//     const customId = `stmt-dedupe-${userId}-${i}`;

//     // Get triple data for similar statements
//     const allSimilarIds = batch.flatMap((b) =>
//       b.similarStatements.map((s) => s.uuid),
//     );
//     const tripleData = await getTripleForStatementsBatch({
//       statementIds: allSimilarIds,
//     });

//     const newStatements = batch.map((b) => ({
//       statement: { uuid: b.statement.uuid, fact: b.statement.fact },
//       subject: "Unknown", // We don't have full triple data for the new statement
//       predicate: "Unknown",
//       object: "Unknown",
//     }));

//     const similarStatements: any[] = [];
//     for (const b of batch) {
//       for (const similar of b.similarStatements) {
//         const triple = tripleData.get(similar.uuid);
//         if (
//           triple &&
//           !similarStatements.find((s) => s.statementId === similar.uuid)
//         ) {
//           similarStatements.push({
//             statementId: similar.uuid,
//             fact: triple.statement.fact,
//             subject: triple.subject.name,
//             predicate: triple.predicate.name,
//             object: triple.object.name,
//           });
//         }
//       }
//     }

//     const promptContext = {
//       newStatements,
//       similarStatements,
//       episodeContent: "Statement deduplication task",
//       referenceTime: new Date().toISOString(),
//     };

//     const messages = resolveStatementPrompt(promptContext);

//     batchRequests.push({
//       customId,
//       messages: messages as CoreMessage[],
//     });

//     batchIndexMap.set(customId, i);
//   }

//   logger.info(
//     `Creating statement deduplication batch with ${batchRequests.length} requests for user ${userId}`,
//   );

//   // Submit batch
//   const { batchId } = await createBatch({
//     requests: batchRequests,
//     modelComplexity: "low",
//   });

//   logger.info(`Statement batch created: ${batchId}, polling for results...`);

//   // Poll for batch completion
//   let batchJob = await getBatch({ batchId });
//   const maxWaitTime = 30 * 60 * 1000;
//   const pollInterval = 10 * 1000;
//   const startTime = Date.now();

//   while (batchJob.status === "pending" || batchJob.status === "processing") {
//     if (Date.now() - startTime > maxWaitTime) {
//       logger.error(`Statement batch ${batchId} timed out after 30 minutes`);
//       return 0;
//     }

//     await new Promise((resolve) => setTimeout(resolve, pollInterval));
//     batchJob = await getBatch({ batchId });
//     logger.info(
//       `Statement batch ${batchId} status: ${batchJob.status}, completed: ${batchJob.completedRequests}/${batchJob.totalRequests}`,
//     );
//   }

//   if (batchJob.status !== "completed") {
//     logger.error(
//       `Statement batch ${batchId} failed with status: ${batchJob.status}`,
//     );
//     return 0;
//   }

//   // Process results and handle duplicates
//   let totalDeduplicated = 0;
//   const duplicatesToDelete: Array<{ newUuid: string; existingUuid: string }> =
//     [];

//   for (const result of batchJob.results || []) {
//     if (result.error) {
//       logger.error(`Statement batch request ${result.customId} failed:`, {
//         error: result.error,
//       });
//       continue;
//     }

//     const responseText = result.response as string;
//     const outputMatch = responseText?.match(/<output>([\s\S]*?)<\/output>/);

//     if (outputMatch && outputMatch[1]) {
//       try {
//         const analysisResult = JSON.parse(outputMatch[1].trim());

//         for (const res of analysisResult) {
//           if (res.isDuplicate && res.duplicateId) {
//             duplicatesToDelete.push({
//               newUuid: res.statementId,
//               existingUuid: res.duplicateId,
//             });
//           }
//         }
//       } catch (error) {
//         logger.error(
//           `Error processing statement resolutions for ${result.customId}:`,
//           { error },
//         );
//       }
//     }
//   }

//   // Process duplicates - move provenance and delete
//   if (duplicatesToDelete.length > 0) {
//     for (const dup of duplicatesToDelete) {
//       await moveAllProvenanceToStatement(dup.newUuid, dup.existingUuid, userId);
//     }
//     await deleteStatements(duplicatesToDelete.map((d) => d.newUuid));
//     totalDeduplicated = duplicatesToDelete.length;
//     logger.info(
//       `Deleted ${totalDeduplicated} duplicate statements for user ${userId}`,
//     );
//   }

//   return totalDeduplicated;
// }

// async function processUserEmbeddings(
//   userId: string,
//   entityCount: number,
//   batchSize: number,
//   skipDeduplication: boolean,
// ) {
//   const errors: string[] = [];
//   let processedEntities = 0;
//   let processedStatements = 0;
//   let entitiesDeduplicated = 0;

//   logger.info(`Processing user ${userId}`, { entityCount });

//   let allEntities: EntityNode[] = [];
//   // Process entities
//   let skip = 0;
//   while (processedEntities < entityCount) {
//     const entities = await getEntitiesWithMissingEmbeddings(
//       userId,
//       skip,
//       batchSize,
//     );
//     allEntities.push(...entities);
//     if (entities.length === 0) break;

//     logger.info(
//       `Processing entities ${processedEntities + 1} - ${processedEntities + entities.length} of ${entityCount}`,
//     );

//     await Promise.all(
//       entities.map(async (entity) => {
//         if (entity.name) {
//           try {
//             const embedding = await getEmbedding(entity.name);
//             await updateEntityEmbedding(entity.uuid, embedding);
//             processedEntities++;
//           } catch (error: any) {
//             errors.push(`Entity ${entity.uuid}: ${error.message}`);
//           }
//         }
//       }),
//     );

//     skip += batchSize;
//   }

//   logger.info(`Processed ${processedEntities} entities for user ${userId}`);

//   // Run semantic deduplication using embeddings + Batch API
//   if (!skipDeduplication) {
//     // Entity deduplication
//     logger.info(`Running semantic entity deduplication for user ${userId}`);
//     entitiesDeduplicated = await semanticDeduplicateEntities(
//       allEntities,
//       userId,
//       batchSize,
//     );
//     if (entitiesDeduplicated > 0) {
//       logger.info(
//         `Merged ${entitiesDeduplicated} semantically similar entities for user ${userId}`,
//       );
//     }
//   }

//   return { entitiesProcessed: processedEntities, entitiesDeduplicated, errors };
// }

// async function processUserStatementEmbeddings(
//   userId: string,
//   statementCount: number,
//   batchSize: number,
//   skipDeduplication: boolean,
// ) {
//   const errors: string[] = [];
//   let processedStatements = 0;
//   let statementsDeduplicated = 0;

//   logger.info(`Processing statements for user ${userId}`, { statementCount });

//   const allStatements: StatementNode[] = [];
//   // Process statements
//   let skip = 0;
//   while (processedStatements < statementCount) {
//     const statements = await getStatementsWithMissingEmbeddings(
//       userId,
//       skip,
//       batchSize,
//     );
//     allStatements.push(...statements);
//     if (statements.length === 0) break;

//     logger.info(
//       `Processing statements ${processedStatements + 1} - ${processedStatements + statements.length} of ${statementCount}`,
//     );

//     await Promise.all(
//       statements.map(async (statement) => {
//         if (statement.fact) {
//           try {
//             const embedding = await getEmbedding(statement.fact);
//             await updateStatementEmbedding(statement.uuid, embedding);
//             processedStatements++;
//           } catch (error: any) {
//             errors.push(`Statement ${statement.uuid}: ${error.message}`);
//           }
//         }
//       }),
//     );

//     skip += batchSize;
//   }

//   logger.info(`Processed ${processedStatements} statements for user ${userId}`);

//   // Run semantic deduplication using embeddings + Batch API
//   if (!skipDeduplication) {
//     logger.info(`Running semantic statement deduplication for user ${userId}`);
//     statementsDeduplicated = await semanticDeduplicateStatements(
//       allStatements,
//       userId,
//       batchSize,
//     );
//     if (statementsDeduplicated > 0) {
//       logger.info(
//         `Deleted ${statementsDeduplicated} duplicate statements for user ${userId}`,
//       );
//     }
//   }

//   return {
//     statementsProcessed: processedStatements,
//     statementsDeduplicated,
//     errors,
//   };
// }

// // Payload for per-user task
// interface UserBackfillPayload {
//   userId: string;
//   entityCount: number;
//   statementCount: number;
//   batchSize: number;
//   skipDeduplication: boolean;
// }

// interface UserBackfillResult {
//   userId: string;
//   entitiesProcessed: number;
//   statementsProcessed: number;
//   entitiesDeduplicated: number;
//   statementsDeduplicated: number;
//   errors: string[];
// }

// /**
//  * Per-user task that processes embeddings and deduplication for a single user
//  */
// export const backfillUserEmbeddingsTask = task({
//   id: "backfill-user-embeddings",
//   machine: "large-2x",
//   run: async (payload: UserBackfillPayload): Promise<UserBackfillResult> => {
//     const result: UserBackfillResult = {
//       userId: payload.userId,
//       entitiesProcessed: 0,
//       statementsProcessed: 0,
//       entitiesDeduplicated: 0,
//       statementsDeduplicated: 0,
//       errors: [],
//     };

//     logger.info(`Processing user ${payload.userId}`, {
//       entityCount: payload.entityCount,
//       statementCount: payload.statementCount,
//     });

//     // Process entities
//     if (payload.entityCount > 0) {
//       const entityResult = await processUserEmbeddings(
//         payload.userId,
//         payload.entityCount,
//         payload.batchSize,
//         payload.skipDeduplication,
//       );
//       result.entitiesProcessed = entityResult.entitiesProcessed;
//       result.entitiesDeduplicated = entityResult.entitiesDeduplicated;
//       result.errors.push(...entityResult.errors);
//     }

//     // Process statements
//     if (payload.statementCount > 0) {
//       const statementResult = await processUserStatementEmbeddings(
//         payload.userId,
//         payload.statementCount,
//         payload.batchSize,
//         payload.skipDeduplication,
//       );
//       result.statementsProcessed = statementResult.statementsProcessed;
//       result.statementsDeduplicated = statementResult.statementsDeduplicated;
//       result.errors.push(...statementResult.errors);
//     }

//     logger.info(`Completed user ${payload.userId}`, { result });
//     return result;
//   },
// });

// /**
//  * Main orchestrator task that fans out to per-user tasks
//  *
//  * Usage:
//  *   await backfillEmbeddingsTask.trigger({});  // Process all users
//  *   await backfillEmbeddingsTask.trigger({ userId: "user123" });  // Specific user
//  */
// export const backfillEmbeddingsTask = task({
//   id: "backfill-embeddings",
//   machine: "large-2x",
//   retry: {
//     maxAttempts: 1,
//   },
//   run: async (
//     payload: BackfillEmbeddingsPayload,
//   ): Promise<BackfillEmbeddingsResult> => {
//     const batchSize = payload.batchSize || 100;
//     const skipDeduplication = payload.skipDeduplication || false;

//     logger.info("Starting embedding backfill orchestrator", {
//       userId: payload.userId || "all",
//       batchSize,
//       skipDeduplication,
//     });

//     const result: BackfillEmbeddingsResult = {
//       success: true,
//       usersProcessed: 0,
//       entitiesProcessed: 0,
//       statementsProcessed: 0,
//       entitiesDeduplicated: 0,
//       statementsDeduplicated: 0,
//       errors: [],
//     };

//     try {
//       // Get users with missing entity embeddings
//       const entityUsers = await getUsersWithMissingEntityEmbeddings(
//         payload.userId,
//       );
//       // Get users with missing statement embeddings
//       const statementUsers = await getUsersWithMissingStatementEmbeddings(
//         payload.userId,
//       );

//       // Merge user lists
//       const userMap = new Map<
//         string,
//         { entityCount: number; statementCount: number }
//       >();

//       for (const user of entityUsers) {
//         userMap.set(user.userId, {
//           entityCount: user.entityCount,
//           statementCount: 0,
//         });
//       }

//       for (const user of statementUsers) {
//         const existing = userMap.get(user.userId);
//         if (existing) {
//           existing.statementCount = user.statementCount;
//         } else {
//           userMap.set(user.userId, {
//             entityCount: 0,
//             statementCount: user.statementCount,
//           });
//         }
//       }

//       if (userMap.size === 0) {
//         logger.info("No users found with missing embeddings");
//         return result;
//       }

//       logger.info(`Found ${userMap.size} users to process`);

//       // Create payloads for batch trigger
//       const userPayloads: UserBackfillPayload[] = Array.from(
//         userMap.entries(),
//       ).map(([userId, counts]) => ({
//         userId,
//         entityCount: counts.entityCount,
//         statementCount: counts.statementCount,
//         batchSize,
//         skipDeduplication,
//       }));

//       // Fan out to per-user tasks (fire and forget)
//       logger.info(`Triggering ${userPayloads.length} user tasks`);

//       const batchHandle = await backfillUserEmbeddingsTask.batchTrigger(
//         userPayloads.map((p) => ({
//           payload: p,
//         })),
//       );

//       result.usersProcessed = userPayloads.length;

//       logger.info("Embedding backfill tasks triggered", {
//         batchId: batchHandle.batchId,
//         totalUsers: userPayloads.length,
//       });

//       return result;
//     } catch (error: any) {
//       logger.error("Error in embedding backfill orchestrator", {
//         error: error.message,
//       });
//       result.success = false;
//       result.errors.push(error.message);
//       return result;
//     }
//   },
// });
