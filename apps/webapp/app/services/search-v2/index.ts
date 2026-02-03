/**
 * Search V2 - Hybrid Router-based Retrieval System
 *
 * New search architecture for CORE's memory recall system.
 * Replaces v1 multi-signal fusion with hybrid router-based retrieval:
 *
 * 1. Vector search → Match topic labels (fast, scalable)
 * 2. LLM → Extract aspects and query type (handles keyword soup)
 * 3. Graph query → Confined to matched labels + filtered by aspects
 *
 * Target latency: ~300-450ms (vs ~1200-2400ms for v1)
 */

import { logger } from "~/services/logger.service";

import type { RecallResult, SearchV2Options, HandlerContext, RouterOutput } from "./types";
import { routeIntent, shouldProceedWithSearch } from "./router";
import { routeToHandler } from "./handlers";
import { formatRecallAsMarkdown, formatForV1Compatibility } from "./formatter";
import { prisma } from "~/db.server";
import { applyTokenBudget, DEFAULT_TOKEN_BUDGET } from "~/services/search/tokenBudget";

/**
 * Log recall event to database for analytics
 */
async function logRecallEvent(params: {
  query: string;
  userId: string;
  result: RecallResult;
  responseTimeMs: number;
  routerOutput: RouterOutput;
  options: SearchV2Options;
}): Promise<void> {
  const { query, userId, result, responseTimeMs, routerOutput, options } = params;

  const episodeCount = result.episodes.length;
  const statementCount = result.statements?.length || 0;
  const hasEntity = result.entity !== null && result.entity !== undefined;

  // Total result count includes episodes, statements, and entity
  const totalResultCount = episodeCount + statementCount + (hasEntity ? 1 : 0);

  // Determine target type based on results
  let targetType = "mixed_results";
  if (totalResultCount === 0) {
    targetType = "no_results";
  } else if (hasEntity && episodeCount === 0 && statementCount === 0) {
    targetType = "entity";
  } else if (statementCount > 0 && episodeCount === 0) {
    targetType = "statement";
  } else if (episodeCount === 1 && statementCount === 0) {
    targetType = "episodic";
  }

  await prisma.recallLog.create({
    data: {
      accessType: "search",
      query,
      targetType,
      searchMethod: "search_v2", // Distinguish from v1's "hybrid"
      minSimilarity: options.fallbackThreshold,
      maxResults: options.limit,
      resultCount: totalResultCount,
      similarityScore: null,
      context: JSON.stringify({
        // V2-specific context
        queryType: routerOutput.queryType,
        aspects: routerOutput.aspects,
        matchedLabels: routerOutput.matchedLabels.map((l) => l.labelName),
        selectedLabels: routerOutput.selectedLabels,
        entityHints: routerOutput.entityHints,
        temporal: routerOutput.temporal,
        confidence: routerOutput.confidence,
        routingTimeMs: routerOutput.routingTimeMs,
        // Result counts breakdown
        episodeCount,
        statementCount,
        hasEntity,
        // Options
        startTime: options.startTime?.toISOString() || null,
        endTime: options.endTime?.toISOString() || null,
        sortBy: options.sortBy,
      }),
      source: options.source ?? "search_v2",
      responseTimeMs,
      metadata: {},
      userId,
    },
  });
}

/**
 * Main search v2 entry point
 *
 * @param query - The search query/intent
 * @param userId - User ID for personalization
 * @param options - Search options
 * @returns V1-compatible structure (structured) or markdown string depending on options.structured
 */
export async function searchV2(
  query: string,
  userId: string,
  options: SearchV2Options = {}
): Promise<ReturnType<typeof formatForV1Compatibility> | string> {
  const startTime = Date.now();

  const workspace = await prisma.workspace.findFirst({where: {
    userId
  }})
  if(!workspace) {
    throw new Error("Workspace not found");
  }

  logger.info(`[SearchV2] Starting search for: "${query.slice(0, 100)}..."`);

  // Step 1: Route the intent (parallel vector + LLM)
  const routerOutput = await routeIntent(query, userId, workspace.id);

  // Step 2: Check if we should search
  if (!shouldProceedWithSearch(routerOutput)) {
    logger.info("[SearchV2] Router determined no search needed");

    const emptyResult: RecallResult = {
      episodes: [],
      invalidatedFacts: [],
      statements: [],
      entity: null,
    };

    return options.structured
      ? formatForV1Compatibility(emptyResult)
      : formatRecallAsMarkdown(emptyResult);
  }

  // Step 3: Build handler context
  const ctx: HandlerContext = {
    userId,
    workspaceId: workspace.id,
    routerOutput,
    options: {
      ...options,
      query, // Pass query for reranking
      fallbackThreshold: options.fallbackThreshold ?? 0.5,
      enableFallback: options.enableFallback ?? true,
      enableReranking: options.enableReranking ?? true,
    },
  };

  let result: RecallResult;
  result = await routeToHandler(ctx);

  // Apply token budget to episodes (drop least relevant from tail until under budget)
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  if (result.episodes.length > 0) {
    const { episodes: budgetedEpisodes, droppedCount, totalTokens } = applyTokenBudget(
      result.episodes,
      tokenBudget
    );
    result = {
      ...result,
      episodes: budgetedEpisodes,
    };

    if (droppedCount > 0) {
      logger.info(
        `[SearchV2] Token budget applied: dropped ${droppedCount} episodes, ` +
          `${budgetedEpisodes.length} remaining (${totalTokens}/${tokenBudget} tokens)`
      );
    }
  }

  const responseTimeMs = Date.now() - startTime;

  logger.info(
    `[SearchV2] Search completed in ${responseTimeMs}ms. ` +
      `Found ${result.episodes.length} episodes, ${result.statements?.length || 0} statements, entity: ${result.entity ? 'yes' : 'no'}`
  );

  // Step 5: Log recall event (non-blocking)
  logRecallEvent({
    query,
    userId,
    result,
    responseTimeMs,
    routerOutput,
    options,
  }).catch((err) => {
    logger.error("[SearchV2] Failed to log recall event:", err);
  });

  // Step 6: Format output
  if (options.structured) {
    return formatForV1Compatibility(result);
  }

  return formatRecallAsMarkdown(result);
}

/**
 * Get just the router output without executing the search
 * Useful for debugging and testing the routing logic
 */
export async function analyzeQuery(
  query: string,
  userId: string
) {
  const workspace = await prisma.workspace.findFirst({where: {
    userId
  }})
  if(!workspace) {
    throw new Error("Workspace not found");
  }
  
  const routerOutput = await routeIntent(query, userId, workspace.id);

  return {
    shouldSearch: shouldProceedWithSearch(routerOutput),
    matchedLabels: routerOutput.matchedLabels,
    queryType: routerOutput.queryType,
    aspects: routerOutput.aspects,
    temporal: routerOutput.temporal,
    entityHints: routerOutput.entityHints,
    confidence: routerOutput.confidence,
    routingTimeMs: routerOutput.routingTimeMs,
  };
}
