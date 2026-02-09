/**
 * Graph Resolution Logic
 *
 * Handles async entity and statement resolution for knowledge graph
 * This runs as a background job after initial episode ingestion
 */

import {
  type Triple,
  type EntityNode,
  type EpisodicNode,
  type StatementNode,
  type AddEpisodeResult,
} from "@core/types";
import { logger } from "~/services/logger.service";
import { dedupeNodes } from "~/services/prompts/nodes";
import { resolveStatementPrompt } from "~/services/prompts/statements";
import {
  deduplicateEntitiesByName,
  deleteOrphanedEntities,
  findSimilarEntities,
  mergeEntities,
} from "~/services/graphModels/entity";
import {
  deleteStatements,
  findContradictoryStatementsBatch,
  findSimilarStatements,
  findStatementsWithSameSubjectObjectBatch,
  getStatements,
  invalidateStatements,
} from "~/services/graphModels/statement";
import {
  getEpisode,
  getEpisodeStatements,
  getSessionEpisodes,
  getTriplesForEpisode,
  moveAllProvenanceToStatement,
} from "~/services/graphModels/episode";
import { makeModelCall } from "~/lib/model.server";
import { prisma } from "~/trigger/utils/prisma";
import { IngestionStatus } from "@core/database";
import { deductCredits } from "~/trigger/utils/utils";

import {
  batchGetEntityEmbeddings,
  batchGetStatementEmbeddings,
  batchDeleteEntityEmbeddings,
  batchDeleteStatementEmbeddings,
} from "~/services/vectorStorage.server";
import { type ModelMessage } from "ai";
import { reconcileCredits } from "../credit_utils";

export interface GraphResolutionPayload {
  episodeUuid: string;
  userId: string;
  workspaceId: string;
  queueId?: string;
  episodeDetails?: AddEpisodeResult;
}

export interface GraphResolutionResult {
  success: boolean;
  resolvedCount?: number;
  invalidatedCount?: number;
  error?: string;
  tokenUsage?: {
    low: { input: number; output: number; total: number; cached: number };
  };
}

/**
 * Process entity and statement resolution for saved triples
 */
export async function processGraphResolution(
  payload: GraphResolutionPayload,
): Promise<GraphResolutionResult> {
  try {
    logger.info(
      `Processing graph resolution for episode ${payload.episodeUuid}`,
    );

    // Get episode data for context
    const episode = await getEpisode(
      payload.episodeUuid,
      false,
      payload.userId,
      payload.workspaceId,
    );
    if (!episode) {
      throw new Error(`Episode ${payload.episodeUuid} not found in graph`);
    }

    // Step 0: Deduplicate entities with same name before resolution
    const { count: deduplicatedCount, deletedUuids: deduplicatedEntityUuids } =
      await deduplicateEntitiesByName(payload.userId, payload.workspaceId);
    if (deduplicatedCount > 0) {
      logger.info(
        `Pre-resolution: deduplicated ${deduplicatedCount} entities for user ${payload.userId}`,
      );

      // Delete embeddings for deduplicated entities
      await batchDeleteEntityEmbeddings(deduplicatedEntityUuids);
      logger.info(
        `Deleted ${deduplicatedEntityUuids.length} embeddings for deduplicated entities`,
      );
    }

    // Fetch triples for this episode from the graph
    const triples = await getTriplesForEpisode(
      payload.episodeUuid,
      payload.userId,
      payload.workspaceId,
    );

    if (triples.length === 0) {
      logger.info(`No triples found for episode ${payload.episodeUuid}`);
      return { success: true, resolvedCount: 0, invalidatedCount: 0 };
    }

    logger.info(
      `Found ${triples.length} triples for episode ${payload.episodeUuid}`,
    );

    // Get previous episodes for context
    let previousEpisodes: EpisodicNode[] = [];
    if (episode.sessionId) {
      previousEpisodes = await getSessionEpisodes(
        episode.sessionId,
        payload.userId,
        5,
        payload.workspaceId,
      );
    }

    // Token metrics for tracking
    const tokenMetrics = {
      high: { input: 0, output: 0, total: 0, cached: 0 },
      low: { input: 0, output: 0, total: 0, cached: 0 },
    };

    // Step 1: Entity Resolution - find which entities should be merged
    const { resolvedTriples, entityMerges } =
      await resolveExtractedNodesWithMerges(
        triples,
        episode,
        previousEpisodes,
        tokenMetrics,
        payload.workspaceId,
      );

    logger.info(
      `Entity resolution completed: ${resolvedTriples.length} triples, ${entityMerges.length} merges`,
    );

    // Step 2: Statement Resolution - find duplicates and contradictions
    const { resolvedStatements, invalidatedStatements, duplicateStatements } =
      await resolveStatementsWithDuplicates(
        resolvedTriples,
        episode,
        previousEpisodes,
        tokenMetrics,
        payload.workspaceId,
      );

    logger.info(
      `Statement resolution completed: ${resolvedStatements.length} resolved, ${invalidatedStatements.length} invalidated, ${duplicateStatements.length} duplicates`,
    );

    // Step 3: Apply entity merges - update references and delete duplicates
    for (const merge of entityMerges) {
      await mergeEntities(
        merge.sourceUuid,
        merge.targetUuid,
        payload.userId,
        payload.workspaceId,
      );
    }

    logger.info(`Merged ${entityMerges.length} duplicate entities`);

    // Step 3.5: Delete embeddings for merged entities
    if (entityMerges.length > 0) {
      const mergedEntityUuids = entityMerges.map((m) => m.sourceUuid);
      await batchDeleteEntityEmbeddings(mergedEntityUuids);
      logger.info(
        `Deleted ${mergedEntityUuids.length} embeddings for merged entities`,
      );
    }

    // Step 4: Handle duplicate statements - move ALL provenance to existing, then delete duplicates
    if (duplicateStatements.length > 0) {
      // Move all provenance relationships from duplicate to existing statement
      // This handles the case where other episodes (B, C) linked to the duplicate
      // while this episode's (A) resolution was pending/failed
      // Run sequentially to avoid Neo4j deadlocks
      let totalMoved = 0;
      for (const dup of duplicateStatements) {
        const moved = await moveAllProvenanceToStatement(
          dup.newStatementUuid,
          dup.existingStatementUuid,
          payload.userId,
          payload.workspaceId,
        );
        totalMoved += moved;
      }

      // Batch delete all duplicate statements at once
      // This is safe even if some were already deleted in a previous attempt
      const duplicateStatementUuids = duplicateStatements.map(
        (dup) => dup.newStatementUuid,
      );
      await deleteStatements(
        duplicateStatementUuids,
        payload.userId,
        payload.workspaceId,
      );
      logger.info(
        `Processed ${duplicateStatements.length} duplicate statements, moved ${totalMoved} provenance relationships`,
      );

      // Delete embeddings for duplicate statements
      await batchDeleteStatementEmbeddings(duplicateStatementUuids);
      logger.info(
        `Deleted ${duplicateStatementUuids.length} embeddings for duplicate statements`,
      );
    }

    // Step 5: Invalidate contradicted statements
    if (invalidatedStatements.length > 0) {
      await invalidateStatements({
        statementIds: invalidatedStatements,
        invalidatedBy: payload.episodeUuid,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
      });
    }

    // Step 6: Clean up orphaned entities (entities with no relationships)
    const { count: orphanedCount, deletedUuids: orphanedEntityUuids } =
      await deleteOrphanedEntities(payload.userId, payload.workspaceId);
    if (orphanedCount > 0) {
      logger.info(`Deleted ${orphanedCount} orphaned entities`);

      // Delete embeddings for orphaned entities
      await batchDeleteEntityEmbeddings(orphanedEntityUuids);
      logger.info(
        `Deleted ${orphanedEntityUuids.length} embeddings for orphaned entities`,
      );
    }

    // Step 7: Update ingestion queue with resolution token usage
    try {
      const queue = await prisma.ingestionQueue.findUnique({
        where: { id: payload.queueId },
        select: { output: true },
      });

      let finalOutput: any = payload.episodeDetails;
      let currentStatus: IngestionStatus = IngestionStatus.COMPLETED;
      const currentOutput = queue?.output as any;
      let episodeUuids: string[] = finalOutput?.episodeUuid
        ? [finalOutput.episodeUuid]
        : [];

      const episodeStatements = finalOutput?.episodeUuid
        ? await getEpisodeStatements({
            episodeUuid: finalOutput.episodeUuid,
            userId: payload.userId,
            workspaceId: payload.workspaceId,
          })
        : [];
      const statementsCount = episodeStatements.length;

      if (currentOutput && currentOutput.episodes.length > 0) {
        currentOutput.episodes.push(payload.episodeDetails);
        episodeUuids = currentOutput.episodes.map(
          (episode: any) => episode.episodeUuid,
        );

        try {
          finalOutput = {
            ...currentOutput,
            statementsCreated:
              currentOutput.statementsCreated + statementsCount,
            resolutionTokenUsage: {
              low: tokenMetrics?.low + currentOutput.resolutionTokenUsage.low,
            },
          };
        } catch (e) {
          finalOutput = {
            ...currentOutput,
            statementsCreated:
              currentOutput.statementsCreated + statementsCount,
          };
        }
      } else {
        finalOutput = {
          episodes: [payload.episodeDetails],
          statementsCreated: statementsCount,
          reservedCredits: currentOutput?.reservedCredits,
          resolutionTokenUsage: {
            low: tokenMetrics.low,
          },
        };
      }

      try {
        await prisma.ingestionQueue.update({
          where: { id: payload.queueId },
          data: {
            output: finalOutput,
            graphIds: episodeUuids,
          },
        });

        logger.info(
          `Updated ingestion queue ${payload.queueId} with resolution metrics`,
        );
      } catch (error) {
        // Record may have been deleted via cascade during document deletion
        logger.warn(
          `Could not update ingestion queue ${payload.queueId} - may have been deleted`,
        );
        // Don't throw - the graph resolution work is still valid
      }

      // Reconcile credits: reserved upfront vs actual statements created
      const reservedCredits = currentOutput?.reservedCredits || 0;
      if (reservedCredits > 0) {
        await reconcileCredits(
          payload.workspaceId,
          payload.userId,
          "addEpisode",
          reservedCredits,
          statementsCount,
        );
      } else {
        // Fallback: no reservation found (legacy path), deduct full amount
        await deductCredits(
          payload.workspaceId,
          payload.userId,
          "addEpisode",
          statementsCount,
        );
      }
    } catch (error) {
      logger.warn(`Failed to update ingestion queue with resolution metrics:`, {
        error,
      });
    }

    return {
      success: true,
      resolvedCount: resolvedStatements.length,
      invalidatedCount: invalidatedStatements.length,
      tokenUsage: {
        low: tokenMetrics.low,
      },
    };
  } catch (error: any) {
    logger.error(`Error processing graph resolution:`, {
      error: error.message,
      episodeUuid: payload.episodeUuid,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Resolve extracted nodes and return merge information
 */
async function resolveExtractedNodesWithMerges(
  triples: Triple[],
  episode: EpisodicNode,
  previousEpisodes: EpisodicNode[],
  tokenMetrics: {
    high: { input: number; output: number; total: number; cached: number };
    low: { input: number; output: number; total: number; cached: number };
  },
  workspaceId: string,
): Promise<{
  resolvedTriples: Triple[];
  entityMerges: Array<{ sourceUuid: string; targetUuid: string }>;
}> {
  const entityMerges: Array<{ sourceUuid: string; targetUuid: string }> = [];

  // Step 1: Extract unique entities from triples
  const uniqueEntitiesMap = new Map<string, EntityNode>();

  triples.forEach((triple) => {
    if (!uniqueEntitiesMap.has(triple.subject.uuid)) {
      uniqueEntitiesMap.set(triple.subject.uuid, triple.subject);
    }
    if (!uniqueEntitiesMap.has(triple.predicate.uuid)) {
      uniqueEntitiesMap.set(triple.predicate.uuid, triple.predicate);
    }
    if (!uniqueEntitiesMap.has(triple.object.uuid)) {
      uniqueEntitiesMap.set(triple.object.uuid, triple.object);
    }
  });

  const uniqueEntities = Array.from(uniqueEntitiesMap.values());

  // Get all entity UUIDs from this episode to exclude from searches
  const currentEntityIds = uniqueEntities.map((e) => e.uuid);

  logger.info("start finding similar entities");

  // Step 1.5: Fetch embeddings from vector provider for all entities
  const entityEmbeddings = await batchGetEntityEmbeddings(
    uniqueEntities.map((e) => e.uuid),
  );

  // Step 2: For each entity, find similar entities for LLM evaluation
  // Note: Exact name matches are already deduplicated before this function is called
  const allEntityResults = await Promise.all(
    uniqueEntities.map(async (entity) => {
      const embedding = entityEmbeddings.get(entity.uuid);
      if (!embedding || embedding.length === 0) {
        // No embedding found, skip similarity search
        return {
          entity,
          similarEntities: [],
        };
      }

      const similarEntities = await findSimilarEntities({
        queryEmbedding: embedding,
        limit: 5,
        threshold: 0.7,
        userId: episode.userId,
        workspaceId: workspaceId,
        excludeUuids: currentEntityIds,
      });
      return {
        entity,
        similarEntities,
      };
    }),
  );

  logger.info("end finding similar entities");

  // Step 3: Separate entities that need LLM resolution from those that don't
  const entityResolutionMap = new Map<string, EntityNode>();
  const entitiesNeedingLLM: typeof allEntityResults = [];

  for (const result of allEntityResults) {
    if (result.similarEntities.length > 0) {
      // Has similar entities - needs LLM resolution
      entitiesNeedingLLM.push(result);
    } else {
      // No matches - keep original
      entityResolutionMap.set(result.entity.uuid, result.entity);
    }
  }

  // Step 4: Only call LLM if there are ambiguous cases
  if (entitiesNeedingLLM.length > 0) {
    const dedupeContext = {
      extracted_nodes: entitiesNeedingLLM.map((result, index) => ({
        id: index,
        name: result.entity.name,
        type: result.entity.type || null,
        attributes: result.entity.attributes || {},
        duplication_candidates: result.similarEntities.map((candidate, j) => ({
          idx: j,
          name: candidate.name,
          type: candidate.type || null,
          attributes: candidate.attributes || {},
        })),
      })),
      episode_content: episode.content,
      previous_episodes: previousEpisodes.map((ep) => ep.content),
    };

    const messages = dedupeNodes(dedupeContext);
    let responseText = "";

    await makeModelCall(
      false,
      messages as ModelMessage[],
      (text, _model, usage) => {
        responseText = text;
        if (usage) {
          tokenMetrics.low.input += usage.promptTokens as number;
          tokenMetrics.low.output += usage.completionTokens as number;
          tokenMetrics.low.total += usage.totalTokens as number;
          tokenMetrics.low.cached += (usage.cachedInputTokens as number) || 0;
        }
      },
      undefined,
      "low",
      "entity-deduplication",
    );

    // Step 5: Process LLM response
    const outputMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch && outputMatch[1]) {
      try {
        const parsedResponse = JSON.parse(outputMatch[1].trim());
        const nodeResolutions = parsedResponse.entity_resolutions || [];

        // First, assume all entities are kept as-is (non-duplicates)
        for (const result of entitiesNeedingLLM) {
          entityResolutionMap.set(result.entity.uuid, result.entity);
        }

        // Then, process ONLY the duplicates returned by LLM
        nodeResolutions.forEach((resolution: any) => {
          const originalEntity = entitiesNeedingLLM[resolution.id];
          if (!originalEntity) return;

          const duplicateIdx = resolution.duplicate_idx ?? -1;

          if (
            duplicateIdx >= 0 &&
            duplicateIdx < originalEntity.similarEntities.length
          ) {
            // This entity should be merged into an existing one
            const targetEntity = originalEntity.similarEntities[duplicateIdx];
            if (targetEntity && targetEntity.uuid) {
              entityResolutionMap.set(originalEntity.entity.uuid, targetEntity);

              // Record the merge
              entityMerges.push({
                sourceUuid: originalEntity.entity.uuid,
                targetUuid: targetEntity.uuid,
              });
            }
          }
        });
      } catch (error) {
        logger.error("Error processing entity resolutions:", { error });
        // Fallback: keep originals for entities that needed LLM
        for (const result of entitiesNeedingLLM) {
          if (!entityResolutionMap.has(result.entity.uuid)) {
            entityResolutionMap.set(result.entity.uuid, result.entity);
          }
        }
      }
    } else {
      // No valid LLM response - keep originals
      for (const result of entitiesNeedingLLM) {
        entityResolutionMap.set(result.entity.uuid, result.entity);
      }
    }
  }

  // Step 6: Update triples with resolved entity references (for return value)
  const resolvedTriples = triples.map((triple) => {
    const newTriple = { ...triple };

    const resolvedSubject = entityResolutionMap.get(triple.subject.uuid);
    if (resolvedSubject) newTriple.subject = resolvedSubject;

    const resolvedPredicate = entityResolutionMap.get(triple.predicate.uuid);
    if (resolvedPredicate) newTriple.predicate = resolvedPredicate;

    const resolvedObject = entityResolutionMap.get(triple.object.uuid);
    if (resolvedObject) newTriple.object = resolvedObject;

    return newTriple;
  });

  return { resolvedTriples, entityMerges };
}

/**
 * Resolve statements and return duplicate information for deletion
 */
async function resolveStatementsWithDuplicates(
  triples: Triple[],
  episode: EpisodicNode,
  previousEpisodes: EpisodicNode[],
  tokenMetrics: {
    high: { input: number; output: number; total: number; cached: number };
    low: { input: number; output: number; total: number; cached: number };
  },
  workspaceId: string,
): Promise<{
  resolvedStatements: Triple[];
  invalidatedStatements: string[];
  duplicateStatements: Array<{
    newStatementUuid: string;
    existingStatementUuid: string;
  }>;
}> {
  const resolvedStatements: Triple[] = [];
  const invalidatedStatements: string[] = [];
  const duplicateStatements: Array<{
    newStatementUuid: string;
    existingStatementUuid: string;
  }> = [];

  if (triples.length === 0) {
    return { resolvedStatements, invalidatedStatements, duplicateStatements };
  }

  // Prepare batch queries for contradiction detection and deduplication

  // Get current episode's statement UUIDs to exclude from searches
  const currentStatementIds = triples.map((t) => t.statement.uuid);

  // Find statements with same subject+predicate (potential contradictions)
  // e.g., "John lives_in NYC" contradicts "John lives_in LA"
  const contradictoryPairs = triples.map((t) => ({
    subjectId: t.subject.uuid,
    predicateId: t.predicate.uuid,
  }));

  // Find statements with same subject+object but different predicate (potential duplicates or contradictions)
  // e.g., duplicates: "John works_at Google" and "John employed_by Google"
  // e.g., contradictions: "John likes Alice" and "John hates Alice"
  const subjectObjectPairs = triples.map((t) => ({
    subjectId: t.subject.uuid,
    objectId: t.object.uuid,
    excludePredicateId: t.predicate.uuid,
  }));

  logger.info("starting batch queries to find contradictory statements");
  // Execute batch queries in parallel
  const [
    contradictoryResults,
    subjectObjectResults,
    previousEpisodesStatements,
  ] = await Promise.all([
    findContradictoryStatementsBatch({
      pairs: contradictoryPairs,
      userId: episode.userId,
      workspaceId: workspaceId,
      excludeStatementIds: currentStatementIds,
    }),
    findStatementsWithSameSubjectObjectBatch({
      pairs: subjectObjectPairs,
      userId: episode.userId,
      workspaceId: workspaceId,
      excludeStatementIds: currentStatementIds,
    }),
    Promise.all(
      previousEpisodes.map(async (ep) => {
        const statements = await getEpisodeStatements({
          episodeUuid: ep.uuid,
          userId: ep.userId,
          workspaceId: workspaceId,
        });
        return statements;
      }),
    ).then((results) => results.flat()),
  ]);

  logger.info("finished finding contradictory statements");

  // Step 1: Collect structural matches (from batch queries) for each triple
  const structuralMatches: Map<
    string,
    { matches: Omit<StatementNode, "factEmbedding">[]; checkedIds: string[] }
  > = new Map();

  for (const triple of triples) {
    const checkedStatementIds: string[] = [];
    let potentialMatches: Omit<StatementNode, "factEmbedding">[] = [];

    const contradictoryKey = `${triple.subject.uuid}_${triple.predicate.uuid}`;
    const exactMatches = contradictoryResults.get(contradictoryKey) || [];
    if (exactMatches.length > 0) {
      potentialMatches.push(...exactMatches);
      checkedStatementIds.push(...exactMatches.map((s) => s.uuid));
    }

    const subjectObjectKey = `${triple.subject.uuid}_${triple.object.uuid}`;
    const subjectObjectMatches =
      subjectObjectResults.get(subjectObjectKey) || [];
    const newSubjectObjectMatches = subjectObjectMatches.filter(
      (match) => !checkedStatementIds.includes(match.uuid),
    );
    if (newSubjectObjectMatches.length > 0) {
      potentialMatches.push(...newSubjectObjectMatches);
      checkedStatementIds.push(...newSubjectObjectMatches.map((s) => s.uuid));
    }

    structuralMatches.set(triple.statement.uuid, {
      matches: potentialMatches,
      checkedIds: checkedStatementIds,
    });
  }

  logger.info("start finding similar statements");

  // Step 1.5: Fetch statement embeddings from vector provider
  const statementEmbeddings = await batchGetStatementEmbeddings(
    triples.map((t) => t.statement.uuid),
  );

  // Step 2: Run all semantic similarity searches in parallel
  const semanticResults = await Promise.all(
    triples.map((triple) => {
      const embedding = statementEmbeddings.get(triple.statement.uuid);
      if (!embedding || embedding.length === 0) {
        // No embedding found, skip similarity search
        return Promise.resolve([]);
      }

      const structural = structuralMatches.get(triple.statement.uuid);
      // Exclude current episode's statements AND already checked structural matches
      const excludeIds = [
        ...currentStatementIds,
        ...(structural?.checkedIds || []),
      ];
      return findSimilarStatements({
        factEmbedding: embedding,
        threshold: 0.7,
        excludeIds,
        userId: triple.provenance.userId,
        workspaceId: workspaceId,
      });
    }),
  );

  logger.info("end finding similar statements");

  // Step 3: Combine all matches
  const allPotentialMatches: Map<
    string,
    Omit<StatementNode, "factEmbedding">[]
  > = new Map();
  const allStatementIdsToFetch = new Set<string>();

  triples.forEach((triple, index) => {
    const structural = structuralMatches.get(triple.statement.uuid);
    let potentialMatches = [...(structural?.matches || [])];
    const checkedStatementIds = [...(structural?.checkedIds || [])];

    const semanticMatches = semanticResults[index];
    if (semanticMatches && semanticMatches.length > 0) {
      potentialMatches.push(...semanticMatches);
      checkedStatementIds.push(...semanticMatches.map((s) => s.uuid));
    }

    const newRelatedFacts = previousEpisodesStatements.filter(
      (fact) =>
        !checkedStatementIds.includes(fact.uuid) &&
        !currentStatementIds.includes(fact.uuid),
    );
    if (newRelatedFacts.length > 0) {
      potentialMatches.push(...newRelatedFacts);
    }

    if (potentialMatches.length > 0) {
      allPotentialMatches.set(triple.statement.uuid, potentialMatches);
      for (const match of potentialMatches) {
        allStatementIdsToFetch.add(match.uuid);
      }
    }
  });

  // Early exit: if no potential matches found for any triple, skip LLM
  if (allStatementIdsToFetch.size === 0) {
    return {
      resolvedStatements: triples,
      invalidatedStatements: [],
      duplicateStatements: [],
    };
  }

  // Batch fetch all triple data
  const userId = triples[0].provenance.userId;
  const allExistingTripleData: Array<StatementNode> = await getStatements({
    statementUuids: Array.from(allStatementIdsToFetch),
    userId,
    workspaceId,
  });

  // Build LLM context
  const newStatements: any[] = [];
  const similarStatements: any[] = [];

  for (const triple of triples) {
    newStatements.push({
      statement: { uuid: triple.statement.uuid, fact: triple.statement.fact },
      subject: triple.subject.name,
      predicate: triple.predicate.name,
      object: triple.object.name,
    });

    const potentialMatches =
      allPotentialMatches.get(triple.statement.uuid) || [];
    for (const match of potentialMatches) {
      const existingTripleData = allExistingTripleData.find(
        (statement) => statement.uuid === match.uuid,
      );
      if (
        existingTripleData &&
        !similarStatements.find((s) => s.statementId === match.uuid)
      ) {
        similarStatements.push({
          statementId: match.uuid,
          fact: existingTripleData.fact,
        });
      }
    }
  }

  if (similarStatements.length > 0) {
    const promptContext = {
      newStatements,
      similarStatements,
      episodeContent: episode.content,
      referenceTime: episode.validAt.toISOString(),
    };

    const messages = resolveStatementPrompt(promptContext);
    let responseText = "";

    await makeModelCall(
      false,
      messages,
      (text, _model, usage) => {
        responseText = text;
        if (usage) {
          tokenMetrics.low.input += usage.promptTokens as number;
          tokenMetrics.low.output += usage.completionTokens as number;
          tokenMetrics.low.total += usage.totalTokens as number;
          tokenMetrics.low.cached += (usage.cachedInputTokens as number) || 0;
        }
      },
      undefined,
      "low",
      "statement-resolution",
    );

    try {
      const jsonMatch = responseText.match(/<output>([\s\S]*?)<\/output>/);

      if (!jsonMatch || !jsonMatch[1]) {
        logger.warn(
          "No valid JSON output found in LLM response for statement resolution",
        );
        // Fallback: keep all statements as-is
        resolvedStatements.push(...triples);
      } else {
        const analysisResult = JSON.parse(jsonMatch[1]);

        // LLM now returns ONLY statements with issues (sparse output for performance)
        // First, assume all statements are kept as-is (no issues)
        const statementIdsWithIssues = new Set(
          analysisResult.map((r: any) => r.statementId),
        );

        // Keep all statements that weren't flagged by LLM
        for (const triple of triples) {
          if (!statementIdsWithIssues.has(triple.statement.uuid)) {
            resolvedStatements.push(triple);
          }
        }

        // Then, process ONLY the flagged statements from LLM
        for (const result of analysisResult) {
          const triple = triples.find(
            (t) => t.statement.uuid === result.statementId,
          );
          if (!triple) continue;

          if (result.isDuplicate && result.duplicateId) {
            // Mark new statement for deletion, link episode to existing
            duplicateStatements.push({
              newStatementUuid: triple.statement.uuid,
              existingStatementUuid: result.duplicateId,
            });
            logger.info(
              `Statement is duplicate, will delete and link to existing: ${triple.statement.fact}`,
            );
          } else {
            // Keep the new statement (it has contradictions but isn't a duplicate)
            resolvedStatements.push(triple);

            // Handle contradictions - invalidate old statements
            if (result.contradictions && result.contradictions.length > 0) {
              invalidatedStatements.push(...result.contradictions);
            }
          }
        }
      }
    } catch (e) {
      logger.error("Error processing statement analysis:", {
        error: e,
        responseText: responseText.substring(0, 500), // Log sample for debugging
        episodeUuid: episode.uuid,
      });
      // Fallback: keep all statements
      resolvedStatements.push(...triples);
    }
  } else {
    // No matches, keep all
    resolvedStatements.push(...triples);
  }

  return { resolvedStatements, invalidatedStatements, duplicateStatements };
}
