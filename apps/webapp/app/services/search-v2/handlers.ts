import { ProviderFactory, VECTOR_NAMESPACES } from "@core/providers";
import { logger } from "~/services/logger.service";
import { applyCohereEpisodeReranking } from "~/services/search/rerank";
import { prisma } from "~/db.server";

import type {
  HandlerContext,
  RecallResult,
  RecallEpisode,
  RecallInvalidatedFact,
} from "./types";
import { getMatchedLabelIds } from "./router";
import { type EntityNode, type EpisodicNode, type StatementAspect, type StatementNode } from "@core/types";

/** Episode with optional relevance score from reranking */
type RankedEpisode = EpisodicNode & { relevanceScore?: number };
import { CohereClientV2 } from "cohere-ai";
import { getEmbedding } from "~/lib/model.server";

/**
 * Apply Cohere reranking to statements
 */
async function applyCohereStatementReranking(
  query: string,
  statements: StatementNode[],
  options?: { limit?: number; model?: string }
): Promise<(StatementNode & { cohereScore: number })[]> {
  const { model = "rerank-v3.5", limit = 50 } = options || {};

  if (statements.length === 0) {
    return [];
  }

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    logger.warn("[Rerank] COHERE_API_KEY not found, skipping reranking");
    return statements.slice(0, limit).map((s) => ({ ...s, cohereScore: 0.5 }));
  }

  try {
    const cohere = new CohereClientV2({ token: apiKey });
    const documents = statements.map((s) => s.fact);

    logger.info(`[Rerank] Reranking ${documents.length} statements with query: "${query.slice(0, 50)}..."`);

    const response = await cohere.rerank({
      query,
      documents,
      model,
      topN: Math.min(limit, documents.length),
    });

    const reranked = response.results.map((result) => ({
      ...statements[result.index],
      cohereScore: result.relevanceScore,
    }));

    logger.info(
      `[Rerank] Top 3: ${reranked
        .slice(0, 3)
        .map((r) => `[${r.cohereScore.toFixed(2)}] ${r.fact.slice(0, 40)}...`)
        .join(" | ")}`
    );

    return reranked;
  } catch (error) {
    logger.error(`[Rerank] Cohere reranking failed: ${error}`);
    return statements.slice(0, limit).map((s) => ({ ...s, cohereScore: 0.5 }));
  }
}

/**
 * Get temporal date range from router output
 */
function getTemporalDateRange(ctx: HandlerContext): {
  startTime?: Date;
  endTime?: Date;
} {
  const { temporal } = ctx.routerOutput;

  switch (temporal.type) {
    case "recent":
      const days = temporal.days;
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - days);
      return { startTime };

    case "range":
      return {
        startTime: new Date(temporal.startDate),
        endTime: new Date(temporal.endDate),
      };

    case "before":
      return {
        endTime: new Date(temporal.endDate),
      };

    case "after":
      return {
        startTime: new Date(temporal.startDate),
      };

    case "all":
    default:
      // Check options for explicit time filters
      return {
        startTime: ctx.options.startTime,
        endTime: ctx.options.endTime,
      };
  }
}

/**
 * Group statements by aspect
 */
function groupByAspect(
  statements: StatementNode[]
): Record<StatementAspect, StatementNode[]> {
  const grouped = {} as Record<StatementAspect, StatementNode[]>;

  for (const stmt of statements) {
    if (stmt.aspect) {
      if (!grouped[stmt.aspect]) {
        grouped[stmt.aspect] = [];
      }
      grouped[stmt.aspect].push(stmt);
    }
  }

  return grouped;
}

/**
 * Handle aspect_query - find episodes with statements matching aspects
 * Returns raw episode nodes without reranking or normalization
 * This is the most common query type
 */
export async function handleAspectQuery(ctx: HandlerContext): Promise<EpisodicNode[]> {
  const startTime = Date.now();
  const graphProvider = ProviderFactory.getGraphProvider();

  const labelIds = getMatchedLabelIds(ctx.routerOutput, ctx.options.fallbackThreshold || 0.5);
  const aspects = ctx.routerOutput.aspects;
  const { startTime: temporalStart, endTime: temporalEnd } = getTemporalDateRange(ctx);
  const maxEpisodes = ctx.options.maxEpisodes || 20;

  logger.info(
    `[Handler:aspect_query] Labels: [${labelIds.join(", ")}], ` +
    `Aspects: [${aspects.join(", ")}], MaxEpisodes: ${maxEpisodes}`
  );

  // Find episodes that have statements matching the aspects
  const episodes = await graphProvider.getEpisodesForAspect({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    labelIds,
    aspects,
    temporalStart,
    temporalEnd,
    maxEpisodes,
  });

  if (episodes.length === 0) {
    logger.info("[Handler:aspect_query] No episodes found");
    return [];
  }

  logger.info(
    `[Handler:aspect_query] Found ${episodes.length} episodes in ${Date.now() - startTime}ms`
  );

  return episodes;
}

/**
 * Result type for entity lookup
 */
type EntityLookupResult =
  | { mode: 'attribute'; entities: EntityNode[] }
  | { mode: 'broad'; episodes: EpisodicNode[]; entities: EntityNode[] };

/**
 * Handle entity_lookup - find information about specific entities
 *
 * Two modes based on router's lookupMode:
 * - "attribute": Direct attribute lookup (e.g., "What is John's phone number?")
 *   → Returns entity with specific attribute
 * - "broad": General entity info (e.g., "Who is John?", "anything about X")
 *   → Returns episodes about the entity
 */
export async function handleEntityLookup(
  ctx: HandlerContext
): Promise<EntityLookupResult | null> {
  const startTime = Date.now();
  const graphProvider = ProviderFactory.getGraphProvider();

  const entityHints = ctx.routerOutput.entityHints;
  const lookupMode = ctx.routerOutput.lookupMode || "broad";
  const attributeHint = ctx.routerOutput.attributeHint;
  const maxEpisodes = Math.floor(ctx.options.maxEpisodes || 20);

  if (entityHints.length === 0) {
    logger.info("[Handler:entity_lookup] No entity hints, returning empty");
    return null;
  }

  logger.info(
    `[Handler:entity_lookup] Mode: ${lookupMode}, Entities: [${entityHints.join(", ")}]` +
    (attributeHint ? `, Attribute: ${attributeHint}` : "")
  );

  // Step 1: Find matching entities using semantic vector search
  const vectorProvider = ProviderFactory.getVectorProvider();
  const allEntities: EntityNode[] = [];

  for (const hint of entityHints) {
    // Get embedding for the hint
    const hintEmbedding = await getEmbedding(hint);

    if (!hintEmbedding || hintEmbedding.length === 0) {
      logger.warn(`[Handler:entity_lookup] Failed to get embedding for hint: ${hint}`);
      continue;
    }

    // Vector search on entity embeddings
    const vectorResults = await vectorProvider.search({
      vector: hintEmbedding,
      namespace: VECTOR_NAMESPACES.ENTITY,
      limit: 5,
      filter: { userId: ctx.userId },
      threshold: 0.7, // Semantic similarity threshold
    });

    // Fetch full entity data for vector matches
    const entityUuids = vectorResults.map((r) => r.id);
    const entityNodes = await graphProvider.getEntities(entityUuids, ctx.userId, ctx.workspaceId);

    allEntities.push(...entityNodes.filter((e) => e && e.uuid && e.name));
  }

  // Deduplicate entities by UUID
  const entityMap = new Map<string, EntityNode>();
  for (const entity of allEntities) {
    if (!entityMap.has(entity.uuid)) {
      entityMap.set(entity.uuid, entity);
    }
  }
  const entities = Array.from(entityMap.values());

  if (entities.length === 0) {
    logger.info("[Handler:entity_lookup] No matching entities found");
    return null;
  }

  logger.info(
    `[Handler:entity_lookup] Found ${entities.length} entities via vector search: [${entities.map((e) => e.name).join(", ")}]`
  );

  // ========================================
  // ATTRIBUTE MODE: Quick attribute lookup
  // ========================================
  if (lookupMode === "attribute" && attributeHint) {
    logger.info(`[Handler:entity_lookup] Attribute mode - looking for: ${attributeHint}`);

    // Check if any entity has the requested attribute
    let foundAttribute = false;
    for (const entity of entities) {
      if (entity.attributes) {
        try {
          // Parse attributes if it's a string (JSON)
          const attrs = typeof entity.attributes === "string"
            ? JSON.parse(entity.attributes)
            : entity.attributes;

          if (!attrs || typeof attrs !== "object") {
            continue;
          }

          // Look for the attribute (case-insensitive key match)
          const attrKey = Object.keys(attrs).find(
            (k) => k && attributeHint &&
              (k.toLowerCase() === attributeHint.toLowerCase() ||
                k.toLowerCase().includes(attributeHint.toLowerCase()))
          );

          if (attrKey && attrs[attrKey]) {
            foundAttribute = true;
            logger.info(
              `[Handler:entity_lookup] Found attribute ${attrKey}=${attrs[attrKey]} for ${entity.name}`
            );
          }
        } catch (error) {
          logger.warn(`[Handler:entity_lookup] Failed to parse attributes for entity ${entity.uuid}: ${error}`);
        }
      }
    }

    // If attribute found, return just entities
    if (foundAttribute) {
      logger.info(
        `[Handler:entity_lookup] Attribute lookup complete: ${entities.length} entities in ${Date.now() - startTime}ms`
      );
      return { mode: 'attribute', entities };
    }

    // Attribute not in entity.attributes - fall through to broad mode
    logger.info(
      `[Handler:entity_lookup] Attribute "${attributeHint}" not in entity attributes, falling back to broad mode`
    );
  }

  // ========================================
  // BROAD MODE: Full entity context (episodes)
  // ========================================
  const entityUuids = entities.map((e) => e.uuid);

  const episodes = await graphProvider.getEpisodesForEntities({
    entityUuids,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    maxEpisodes,
  });

  logger.info(
    `[Handler:entity_lookup] Returning ${entities.length} entities with ${episodes.length} episodes in ${Date.now() - startTime}ms`
  );

  return { mode: 'broad', episodes, entities };
}

/**
 * Handle temporal - time-based queries
 * Returns raw episode nodes without reranking or normalization
 */
export async function handleTemporal(
  ctx: HandlerContext
): Promise<EpisodicNode[]> {
  const startTime = Date.now();
  const graphProvider = ProviderFactory.getGraphProvider();

  const labelIds = getMatchedLabelIds(ctx.routerOutput, ctx.options.fallbackThreshold || 0.5);
  const { startTime: temporalStart, endTime: temporalEnd } = getTemporalDateRange(ctx);
  const limit = Math.floor(ctx.options.maxEpisodes || 10);

  // Default to last 7 days if no temporal filter specified
  const effectiveStart =
    temporalStart || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  logger.info(
    `[Handler:temporal] Time range: ${effectiveStart.toISOString()} - ${temporalEnd?.toISOString() || "now"}`
  );

  // Get episodes within time range using graph provider method
  const episodes = await graphProvider.getEpisodesForTemporal({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    labelIds,
    aspects: ctx.routerOutput.aspects,
    startTime: effectiveStart,
    endTime: temporalEnd,
    maxEpisodes: limit,
  });

  if (episodes.length === 0) {
    logger.info("[Handler:temporal] No episodes found in time range");
    return [];
  }

  logger.info(
    `[Handler:temporal] Found ${episodes.length} episodes in ${Date.now() - startTime}ms`
  );

  return episodes;
}

/**
 * Handle exploratory - broad topic/project queries
 * Returns raw episode nodes without reranking or normalization
 *
 * Exploratory queries are for broad exploration across a topic/project:
 * - "search implementation in CORE"
 * - "authentication architecture"
 * - "recent progress on feature X"
 */
export async function handleExploratory(
  ctx: HandlerContext
): Promise<EpisodicNode[]> {
  const startTime = Date.now();
  const graphProvider = ProviderFactory.getGraphProvider();

  const labelIds = getMatchedLabelIds(ctx.routerOutput, ctx.options.fallbackThreshold || 0.5);
  const maxEpisodes = ctx.options.maxEpisodes || 20;

  logger.info(
    `[Handler:exploratory] Labels: [${labelIds.join(", ")}], MaxEpisodes: ${maxEpisodes}`
  );

  if (labelIds.length === 0) {
    logger.info("[Handler:exploratory] No labels matched, falling back to recent episodes");
  }

  // Get episodes filtered by labels using graph provider method
  const episodes = await graphProvider.getEpisodesForExploratory({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    labelIds,
    maxEpisodes,
  });

  if (episodes.length === 0) {
    logger.info("[Handler:exploratory] No episodes found for labels");
    return [];
  }

  logger.info(
    `[Handler:exploratory] Found ${episodes.length} episodes in ${Date.now() - startTime}ms`
  );

  return episodes;
}

/**
 * Handle relationship - find connections between entities
 */
/**
 * Handle relationship - find connections between entities
 * Returns raw statement nodes without reranking or normalization
 */
export async function handleRelationship(
  ctx: HandlerContext
): Promise<StatementNode[]> {
  const startTime = Date.now();
  const graphProvider = ProviderFactory.getGraphProvider();

  const entityHints = ctx.routerOutput.entityHints;
  const limit = Math.floor(ctx.options.maxStatements || 50);

  if (entityHints.length < 2) {
    logger.info(
      "[Handler:relationship] Need at least 2 entities for relationship query"
    );
    return [];
  }

  logger.info(
    `[Handler:relationship] Finding relationships between: [${entityHints.join(", ")}]`
  );

  // Find statements that connect the hinted entities
  const statements = await graphProvider.getStatementsConnectingEntities({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    entityHint1: entityHints[0],
    entityHint2: entityHints[1],
    maxStatements: limit,
  });

  if (statements.length === 0) {
    logger.info("[Handler:relationship] No statements found connecting entities");
    return [];
  }

  logger.info(
    `[Handler:relationship] Found ${statements.length} statements in ${Date.now() - startTime}ms`
  );

  return statements;
}


/**
 * Apply vector similarity reranking using batchScore
 * Embeds the query, scores episodes by cosine similarity, sorts by score
 */
async function applyVectorReranking(
  episodes: EpisodicNode[],
  query: string,
  maxEpisodes: number,
  threshold: number,
): Promise<RankedEpisode[]> {
  const startTime = Date.now();
  const queryEmbedding = await getEmbedding(query);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    logger.warn("[Reranking:vector] Failed to get query embedding, returning original order");
    return episodes.slice(0, maxEpisodes);
  }

  const vectorProvider = ProviderFactory.getVectorProvider();
  const episodeUuids = episodes.map((ep) => ep.uuid);

  const scores = await vectorProvider.batchScore({
    vector: queryEmbedding,
    ids: episodeUuids,
    namespace: VECTOR_NAMESPACES.EPISODE,
  });

  // Attach scores and sort by similarity descending
  const scored = episodes
    .map((ep) => ({
      ...ep,
      relevanceScore: scores.get(ep.uuid) ?? 0,
    }))
    .filter((ep) => ep.relevanceScore >= threshold)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxEpisodes);

  logger.info(
    `[Reranking:vector] ${episodes.length} → ${scored.length} episodes in ${Date.now() - startTime}ms ` +
    `(threshold ${threshold}, top: ${scored[0]?.relevanceScore?.toFixed(3) ?? "N/A"})`
  );

  return scored;
}

/**
 * Apply episode reranking if enabled
 * Uses Cohere when available, falls back to vector similarity
 */
async function applyEpisodeReranking(
  episodes: EpisodicNode[],
  ctx: HandlerContext,
  options?: { threshold?: number }
): Promise<RankedEpisode[]> {
  const enableReranking = ctx.options.enableReranking !== false;
  const query = ctx.options.query;
  const maxEpisodes = ctx.options.maxEpisodes || 20;
  const RELEVANCE_THRESHOLD = options?.threshold ?? 0.1;

  if (!enableReranking || !query || episodes.length <= 1) {
    return episodes.slice(0, maxEpisodes);
  }

  // Use Cohere if API key is configured
  if (process.env.COHERE_API_KEY) {
    try {
      const episodesForRerank = episodes.map((ep) => ({
        episode: {
          uuid: ep.uuid,
          content: ep.content,
          originalContent: ep.originalContent || ep.content,
        },
      }));

      const reranked = await applyCohereEpisodeReranking(query, episodesForRerank, {
        limit: maxEpisodes,
        model: "rerank-v3.5",
      });

      const rerankedEpisodes = reranked
        .filter((r: any) => r.cohereScore >= RELEVANCE_THRESHOLD)
        .map((r: any) => {
          const original = episodes.find((e) => e.uuid === r.episode.uuid)!;
          return {
            ...original,
            relevanceScore: r.cohereScore,
          };
        });

      logger.info(
        `[Reranking:cohere] ${episodes.length} → ${rerankedEpisodes.length} episodes (threshold ${RELEVANCE_THRESHOLD})`
      );
      return rerankedEpisodes;
    } catch (error) {
      logger.warn(`[Reranking:cohere] Failed, falling back to vector reranking: ${error}`);
    }
  }

  // Fallback: vector similarity reranking
  try {
    return await applyVectorReranking(episodes, query, maxEpisodes, RELEVANCE_THRESHOLD);
  } catch (error) {
    logger.warn(`[Reranking:vector] Failed, using original order: ${error}`);
    return episodes.slice(0, maxEpisodes);
  }
}

/**
 * Apply statement reranking if enabled
 * Returns reranked statements filtered by relevance
 */
async function applyStatementReranking(
  statements: StatementNode[],
  ctx: HandlerContext,
  options?: { threshold?: number }
): Promise<StatementNode[]> {
  const enableReranking = ctx.options.enableReranking !== false;
  const query = ctx.options.query;
  const maxStatements = ctx.options.maxStatements || 50;
  const RELEVANCE_THRESHOLD = options?.threshold ?? 0.1;

  if (!enableReranking || !query || statements.length <= 1) {
    return statements.slice(0, maxStatements);
  }

  try {
    const reranked = await applyCohereStatementReranking(query, statements, {
      limit: maxStatements,
    });

    // Filter low-relevance statements
    const rerankedStatements = reranked
      .filter((s) => s.cohereScore >= RELEVANCE_THRESHOLD)
      .map(({ cohereScore, ...rest }) => rest); // Remove cohereScore from final output

    logger.info(
      `[Reranking] Reranked ${statements.length} statements to ${rerankedStatements.length} (threshold ${RELEVANCE_THRESHOLD})`
    );
    return rerankedStatements as StatementNode[];
  } catch (error) {
    logger.warn(`[Reranking] Statement reranking failed, using original order: ${error}`);
    return statements.slice(0, maxStatements);
  }
}

/**
 * Replace session episodes with compacted session documents from Document table
 * Groups episodes by sessionId, fetches compacts, replaces with highest-scored episode position
 */
async function replaceWithCompacts(
  episodes: RankedEpisode[],
  ctx: HandlerContext
): Promise<RecallEpisode[]> {
  if (episodes.length === 0) return [];

  // Group episodes by sessionId
  const sessionGroups = new Map<
    string,
    {
      episodes: RankedEpisode[];
      highestScore: number;
      firstIndex: number;
    }
  >();

  episodes.forEach((ep, index) => {
    if (ep.sessionId && ep.type !== "DOCUMENT") {
      if (!sessionGroups.has(ep.sessionId)) {
        sessionGroups.set(ep.sessionId, {
          episodes: [],
          highestScore: ep.relevanceScore || 0,
          firstIndex: index,
        });
      }
      const group = sessionGroups.get(ep.sessionId)!;
      group.episodes.push(ep);
      if ((ep.relevanceScore || 0) > group.highestScore) {
        group.highestScore = ep.relevanceScore || 0;
      }
    }
  });

  logger.info(
    `[replaceWithCompacts] Found ${sessionGroups.size} sessions to check for compacts`
  );

  // Fetch compacted session documents from Document table
  const compactDocs = await prisma.document.findMany({
    where: {
      sessionId: { in: Array.from(sessionGroups.keys()) },
      workspaceId: ctx.workspaceId,
      type: "conversation", // Compacted sessions have type "conversation"
      deleted: null,
    },
  });

  const compactMap = new Map(compactDocs.map((doc) => [doc.sessionId!, doc]));

  logger.info(
    `[replaceWithCompacts] Found ${compactMap.size} compacted session documents`
  );

  // Build result: replace session episodes with compacts
  const result: RecallEpisode[] = [];
  const processedSessions = new Set<string>();

  for (let index = 0; index < episodes.length; index++) {
    const ep = episodes[index];
    const sessionId = ep.sessionId;
    const isDocument = ep.type === "DOCUMENT";

    // Session episode - replace with compact if available
    if (sessionId && !isDocument) {
      if (processedSessions.has(sessionId)) {
        continue; // Skip, already added compact
      }

      const compactDoc = compactMap.get(sessionId);
      const group = sessionGroups.get(sessionId)!;

      // Only replace with compact if there are > 2 episodes from this session
      if (compactDoc && group.episodes.length > 2) {
        // Collect unique labelIds from all episodes in this session
        const sessionLabelIds = Array.from(
          new Set(group.episodes.flatMap((ep) => ep.labelIds || []))
        );

        result.push({
          uuid: compactDoc.id, // Use document ID as uuid
          content: compactDoc.content,
          createdAt: compactDoc.createdAt,
          labelIds: sessionLabelIds,
          isCompact: true,
          relevanceScore: group.highestScore,
        });
        processedSessions.add(sessionId);

        logger.debug(
          `[replaceWithCompacts] Replaced session ${sessionId.slice(0, 8)} with compact, score: ${group.highestScore.toFixed(3)}`
        );
      } else {
        // No compact, keep episode
        result.push({
          uuid: ep.uuid,
          content: ep.originalContent || ep.content,
          createdAt: ep.createdAt,
          labelIds: ep.labelIds || [],
          relevanceScore: ep.relevanceScore,
        });
      }
    } else {
      // Document episode - keep as is
      result.push({
        uuid: ep.uuid,
        content: ep.originalContent || ep.content,
        createdAt: ep.createdAt,
        labelIds: ep.labelIds || [],
        isDocument,
        relevanceScore: ep.relevanceScore,
      });
    }
  }

  return result;
}

/**
 * Extract invalidated statements for the given episodes
 * Returns facts that have invalidAt set (no longer valid)
 */
async function extractInvalidatedFacts(
  episodes: EpisodicNode[],
  ctx: HandlerContext
): Promise<RecallInvalidatedFact[]> {
  if (episodes.length === 0) return [];

  const graphProvider = ProviderFactory.getGraphProvider();
  const episodeUuids = episodes.map((ep) => ep.uuid);

  logger.info(
    `[extractInvalidatedFacts] Fetching invalidated statements for ${episodeUuids.length} episodes`
  );

  // Get all statements for these episodes
  const invalidFacts = await graphProvider.getEpisodesInvalidFacts(episodeUuids, ctx.userId, ctx.workspaceId);

  // Filter for invalidated statements only
  const invalidatedFacts = invalidFacts.map((stmt) => ({
    fact: stmt.fact,
    validAt: stmt.validAt,
    invalidAt: stmt.invalidAt,
    relevantScore: 0, // No score for invalidated facts
  }));

  logger.info(
    `[extractInvalidatedFacts] Found ${invalidatedFacts.length} invalidated facts`
  );

  return invalidatedFacts;
}

/**
 * Normalize handler result to RecallResult format
 * Ensures consistent output regardless of which handler was used
 */
async function normalizeToRecallResult(
  handlerResult: any,
  ctx: HandlerContext
): Promise<RecallResult> {
  // Extract episodes from various possible sources
  const rawEpisodes = handlerResult.episodes || handlerResult.episodesWithContent || [];

  // Step 1: Replace session episodes with compacts
  const episodes = await replaceWithCompacts(rawEpisodes, ctx);

  // Step 2: Extract invalidated facts for returned episodes
  const invalidatedFacts = await extractInvalidatedFacts(rawEpisodes, ctx);

  // Extract statements if present
  const statements: RecallResult["statements"] = handlerResult.statements?.map((s: any) => ({
    fact: s.fact,
    validAt: s.validAt,
    attributes: s.attributes || {},
    aspect: s.aspect,
  })) || [];

  // Extract entity if present (first entity for entity_lookup)
  const entity: RecallResult["entity"] = handlerResult.entities?.[0]
    ? {
      uuid: handlerResult.entities[0].uuid,
      name: handlerResult.entities[0].name,
      attributes: handlerResult.entities[0].attributes || {},
    }
    : null;

  return {
    episodes,
    invalidatedFacts,
    statements,
    entity,
  };
}


/**
 * Route to appropriate handler based on query type
 * Applies reranking and normalization for episode-returning handlers
 */
export async function routeToHandler(
  ctx: HandlerContext
): Promise<RecallResult> {
  const { queryType } = ctx.routerOutput;

  switch (queryType) {
    case "entity_lookup": {
      const result = await handleEntityLookup(ctx);

      // No entities found
      if (result === null) {
        return await normalizeToRecallResult({}, ctx);
      }

      // Attribute mode - return entity only
      if (result.mode === 'attribute') {
        return await normalizeToRecallResult({
          entities: result.entities,
          entity: result.entities[0]
        }, ctx);
      }

      // Broad mode - return episodes with entity
      const rerankedEpisodes = await applyEpisodeReranking(result.episodes, ctx);
      return await normalizeToRecallResult({
        episodes: rerankedEpisodes,
        entities: result.entities,
        entity: result.entities[0]
      }, ctx);
    }

    case "aspect_query": {
      const episodes = await handleAspectQuery(ctx);
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx);
      return await normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
    }

    case "temporal": {
      const episodes = await handleTemporal(ctx);
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx);
      return await normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
    }

    case "exploratory": {
      const episodes = await handleExploratory(ctx);
      // Lower threshold for exploratory (broader results)
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx, { threshold: 0.05 });
      return await normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
    }

    case "relationship": {
      const statements = await handleRelationship(ctx);
      const rerankedStatements = await applyStatementReranking(statements, ctx);
      return await normalizeToRecallResult({ statements: rerankedStatements }, ctx);
    }

    default:
      logger.warn(`[Handler] Unknown query type: ${queryType}, using aspect_query`);
      const episodes = await handleAspectQuery(ctx);
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx);
      return await normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
  }
}
