import type { EntityNode, EpisodeSearchResult, EpisodeWithProvenance, EpisodicNode, RerankConfig, SearchOptions, StatementNode } from "@core/types";
import { logger } from "./logger.service";
import {
  performBfsSearch,
  performBM25Search,
  performVectorSearch,
  performEpisodeGraphSearch,
  extractEntitiesFromQuery,
  type EpisodeGraphResult,
} from "./search/utils";
import { applyEpisodeReranking, applyMultiFactorReranking } from "./search/rerank";
import { getEmbedding, makeModelCall } from "~/lib/model.server";
import { prisma } from "~/db.server";
import { runQuery } from "~/lib/neo4j.server";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { env } from "~/env.server";
import { getCompactedSessionBySessionId } from "./graphModels/compactedSession";

/**
 * SearchService provides methods to search the reified + temporal knowledge graph
 * using a hybrid approach combining BM25, vector similarity, and BFS traversal.
 */
export class SearchService {
  async getEmbedding(text: string) {
    return getEmbedding(text);
  }

  /**
   * Search the knowledge graph using a hybrid approach
   * @param query The search query
   * @param userId The user ID for personalization
   * @param options Search options
   * @returns Markdown formatted context (default) or structured JSON (if structured: true)
   */
  public async search(
    query: string,
    userId: string,
    options: SearchOptions = {},
    source?: string,
  ): Promise<string | {
    episodes: {
      uuid: string;
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
      relevanceScore?: number;
    }[];
    invalidatedFacts: {
      fact: string;
      validAt: Date;
      invalidAt: Date | null;
      relevantScore: number;
    }[];
  }> {
    const startTime = Date.now();
    // Default options

    const opts: Required<SearchOptions> = {
      limit: options.limit || 100, // Maximum episodes in final response
      maxBfsDepth: options.maxBfsDepth || 3,
      validAt: options.validAt || new Date(),
      startTime: options.startTime || null,
      endTime: options.endTime || new Date(),
      includeInvalidated: options.includeInvalidated || true,
      entityTypes: options.entityTypes || [],
      predicateTypes: options.predicateTypes || [],
      scoreThreshold: options.scoreThreshold || 0.7,
      minResults: options.minResults || 10,
      spaceIds: options.spaceIds || [],
      adaptiveFiltering: options.adaptiveFiltering || false,
      structured: options.structured || false,
      useLLMValidation: options.useLLMValidation || true,
      qualityThreshold: options.qualityThreshold || 0.3,
      maxEpisodesForLLM: options.maxEpisodesForLLM || 20,
      sortBy: options.sortBy || 'relevance',
    };

    // Enhance query with LLM to transform keyword soup into semantic query

    const queryVector = await this.getEmbedding(query);

    // Note: We still need to extract entities from graph for Episode Graph search
    // The LLM entities are just strings, we need EntityNode objects from the graph
    const entities = await extractEntitiesFromQuery(query, userId, []);
    logger.info(`Extracted entities ${entities.map((e: EntityNode) => e.name).join(', ')}`);

    // 1. Run parallel search methods (including episode graph search) using enhanced query
    const searchStartTime = Date.now();
    const searchTimings = {
      bm25: 0,
      vector: 0,
      bfs: 0,
      episodeGraph: 0,
    };
    
    const [bm25Results, vectorResults, bfsResults, episodeGraphResults] = await Promise.all([
      performBM25Search(query, userId, opts).then(r => {
        searchTimings.bm25 = Date.now() - searchStartTime;
        logger.info(`BM25 search completed in ${searchTimings.bm25}ms`);
        return r;
      }),
      performVectorSearch(queryVector, userId, opts).then(r => {
        searchTimings.vector = Date.now() - searchStartTime;
        logger.info(`Vector search completed in ${searchTimings.vector}ms`);
        return r;
      }),
      performBfsSearch(query, queryVector, userId, entities, opts).then(r => {
        searchTimings.bfs = Date.now() - searchStartTime;
        logger.info(`BFS search completed in ${searchTimings.bfs}ms`);
        return r;
      }),
      performEpisodeGraphSearch(entities, queryVector, userId, opts).then(r => {
        searchTimings.episodeGraph = Date.now() - searchStartTime;
        logger.info(`Episode graph search completed in ${searchTimings.episodeGraph}ms`);
        return r;
      }),
    ]);

    logger.info(
      `Search results - BM25: ${bm25Results.length}, Vector: ${vectorResults.length}, BFS: ${bfsResults.length}, EpisodeGraph: ${episodeGraphResults.length}`,
    );

    // 2. TWO-STAGE RANKING PIPELINE: Quality-based filtering with hierarchical scoring

    // Stage 1: Extract episodes with provenance tracking
    let episodesWithProvenance = await this.extractEpisodesWithProvenance({
      episodeGraph: episodeGraphResults,
      bfs: bfsResults,
      vector: vectorResults,
      bm25: bm25Results,
    });

    logger.info(`Extracted ${episodesWithProvenance.length} unique episodes from all sources`);

    // Batch-fetch entity match counts for all episodes (for reranking boost)
    const queryEntityIds = entities.map((e: EntityNode) => e.uuid);
    const entityMatchCounts = await this.fetchEntityMatchCounts(
      episodesWithProvenance,
      queryEntityIds,
      userId
    );

    // Assign entity match counts to episodes
    episodesWithProvenance.forEach(ep => {
      ep.entityMatchCount = entityMatchCounts.get(ep.episode.uuid) || 0;
    });

    logger.info(
      `Entity matching: ${episodesWithProvenance.filter(ep => ep.entityMatchCount! > 0).length}/${episodesWithProvenance.length} ` +
      `episodes have matching entities`
    );

    // Filter episodes with 0 entity matches (only if query has entities)
    // This removes irrelevant episodes that have no semantic connection to the query
    if (queryEntityIds.length > 0) {
      const beforeFilter = episodesWithProvenance.length;
      episodesWithProvenance = episodesWithProvenance.filter(ep =>
        (ep.entityMatchCount || 0) > 0
      );

      logger.info(
        `Entity filtering: ${episodesWithProvenance.length}/${beforeFilter} episodes kept ` +
        `(removed ${beforeFilter - episodesWithProvenance.length} episodes with 0 entity matches)`
      );

      // If filtering removed everything, log warning but continue
      // (reranking will handle empty results gracefully)
      if (episodesWithProvenance.length === 0) {
        logger.warn(`Entity filtering removed all episodes - no episodes matched query entities`);
      }
    } else {
      logger.info(`Skipping entity filtering: no entities extracted from query (semantic/abstract query)`);
    }

    // Build reranking configuration from environment
    const thresholdValue = parseFloat(
      env.RERANK_PROVIDER === 'cohere'
        ? env.COHERE_SCORE_THRESHOLD
        : env.RERANK_PROVIDER === 'ollama'
          ? env.OLLAMA_SCORE_THRESHOLD
          : '0.2'
    );

    const rerankConfig: RerankConfig = {
      provider: (env.RERANK_PROVIDER || 'none') as 'cohere' | 'ollama' | 'none',
      limit: Math.min(episodesWithProvenance.length, 100),
      threshold: isNaN(thresholdValue) ? 0.3 : thresholdValue,
      cohereApiKey: env.COHERE_API_KEY,
      cohereModel: env.COHERE_RERANK_MODEL,
      ollamaUrl: env.OLLAMA_URL,
      ollamaModel: env.OLLAMA_RERANK_MODEL,
    };

    logger.info(
      `Reranking with provider: ${rerankConfig.provider}` +
      (rerankConfig.threshold > 0 ? `, threshold: ${rerankConfig.threshold}` : '')
    );

    // Apply reranking (dispatches to Cohere, Ollama, or original multi-stage algorithm)
    let finalEpisodes: (EpisodeWithProvenance & { rerankScore: number })[] = [];

    if (episodesWithProvenance.length > 0) {
      const reranked = await applyEpisodeReranking(
        query,
        episodesWithProvenance,
        rerankConfig,
        opts
      );

      // Filter by threshold if using a reranking model
      if (rerankConfig.provider !== 'none' && (rerankConfig.threshold !== undefined) && (rerankConfig.threshold > 0)) {
        finalEpisodes = reranked.filter(ep => ep.rerankScore >= rerankConfig.threshold);

        logger.info(
          `Reranking (${rerankConfig.provider}): ${reranked.length} episodes reranked, ` +
          `${finalEpisodes.length} passed threshold (>=${rerankConfig.threshold}), ` +
          `top score: ${reranked[0]?.rerankScore || 'N/A'}`
        );

        if (finalEpisodes.length === 0 && Math.abs(reranked[0].rerankScore - 0.00) > Number.EPSILON) {
          logger.warn(
            `No episodes passed ${rerankConfig.provider} threshold ${rerankConfig.threshold} for query: "${query}". ` +
            `Falling back to original multi-stage reranking algorithm.`
          );

          // Fallback to original multi-stage algorithm
          const fallbackReranked = await applyMultiFactorReranking(
            query,
            episodesWithProvenance,
            Math.min(episodesWithProvenance.length, 100),
            opts
          );

          logger.info(
            `Fallback reranking: ${fallbackReranked.length} episodes returned using original algorithm`
          );
          finalEpisodes = fallbackReranked.filter(ep => ep.rerankScore >= rerankConfig.threshold);

          // If even the fallback returns nothing, then return empty
          if (fallbackReranked.length === 0) {
            logger.warn(`No episodes found even after fallback for query: "${query}"`);
            return opts.structured
              ? { episodes: [], invalidatedFacts: [] }
              : this.formatAsMarkdown([], []);
          }
        }
      } else {
        // No threshold filtering for 'none' provider
        finalEpisodes = reranked;
        logger.info(
          `No reranking model used, returning top ${finalEpisodes.length} episodes by original search scores`
        );
      }
    } else {
      logger.warn(`No episodes found for query: "${query}"`);
      return opts.structured
        ? { episodes: [], invalidatedFacts: [] }
        : this.formatAsMarkdown([], []);
    }

    // Apply limit to final episodes
    const limitedEpisodes = finalEpisodes.slice(0, opts.limit);

    if (finalEpisodes.length > opts.limit) {
      logger.warn(
        `Limiting episodes from ${finalEpisodes.length} to ${opts.limit} (limit option)`
      );
    }

    // Apply sorting based on sortBy option
    let sortedEpisodes = limitedEpisodes;
    if (opts.sortBy === 'recency') {
      sortedEpisodes = [...limitedEpisodes].sort((a, b) =>
        new Date(b.episode.createdAt).getTime() - new Date(a.episode.createdAt).getTime()
      );
      logger.info(`Sorted ${sortedEpisodes.length} episodes by recency (newest first)`);
    } else {
      // Already sorted by relevance from reranking
      logger.info(`Using relevance-sorted order (default)`);
    }

    // Extract episodes and statements for response
    const filteredResults = sortedEpisodes.flatMap((ep) =>
      ep.statements.map((s) => ({
        statement: s.statement,
        score: ep.rerankScore || 0,
      })),
    );

    logger.info(
      `Final results: ${sortedEpisodes.length} episodes, ${filteredResults.length} statements`
    );

    // Replace session episodes with compacts automatically (preserve rerank scores)
    const unifiedEpisodes = await this.replaceWithCompacts(sortedEpisodes, userId);

    // Only include invalidated facts (valid facts are already in episode content)
    // Filter for statements that have a valid invalidAt date (not null, undefined, or empty string)
    const factsData = filteredResults
      .filter((statement) => {
        const invalidAt = statement.statement.invalidAt;
        // Check if invalidAt is a valid date (not null, undefined, empty string, or invalid date)
        return invalidAt && invalidAt !== null
      })
      .map((statement) => ({
        fact: statement.statement.fact,
        validAt: statement.statement.validAt,
        invalidAt: statement.statement.invalidAt,
        relevantScore: statement.score,
        factUuid: statement.statement.uuid,
      }));

    // Calculate response content for token counting
    let responseContent: string;
    if (opts.structured) {
      responseContent = JSON.stringify({
        episodes: unifiedEpisodes,
        invalidatedFacts: factsData,
      });
    } else {
      responseContent = this.formatAsMarkdown(unifiedEpisodes, factsData);
    }

    // Estimate token count (rough approximation: 1 token ≈ 4 characters)
    const tokenCount = encode(responseContent).length;

    // Update the async log with token count
    const responseTime = Date.now() - startTime;

    this.updateRecallCount(
      userId,
      limitedEpisodes.map((ep) => ep.episode),
      filteredResults.map((item) => item.statement),
    );

    this.logRecallAsync(
      query,
      userId,
      limitedEpisodes.length,
      opts,
      responseTime,
      source,
      tokenCount,
      searchTimings,
    ).catch((error) => {
      logger.error("Failed to log recall event:", error);
    });

    // Return markdown by default, structured JSON if requested
    if (opts.structured) {
      return {
        episodes: unifiedEpisodes,
        invalidatedFacts: factsData,
      };
    }

    // Return markdown formatted context
    return responseContent;
  }

  private async logRecallAsync(
    query: string,
    userId: string,
    episodeCount: number,
    options: Required<SearchOptions>,
    responseTime: number,
    source?: string,
    tokenCount?: number,
    searchTimings?: { bm25: number; vector: number; bfs: number; episodeGraph: number },
  ): Promise<void> {
    try {
      // Determine target type based on episode count
      let targetType = "mixed_results";
      if (episodeCount === 1) {
        targetType = "episodic";
      } else if (episodeCount === 0) {
        targetType = "no_results";
      }

      await prisma.recallLog.create({
        data: {
          accessType: "search",
          query,
          targetType,
          searchMethod: "hybrid", // BM25 + Vector + BFS
          minSimilarity: options.scoreThreshold,
          maxResults: options.limit,
          resultCount: episodeCount,
          similarityScore: null,
          context: JSON.stringify({
            entityTypes: options.entityTypes,
            predicateTypes: options.predicateTypes,
            maxBfsDepth: options.maxBfsDepth,
            includeInvalidated: options.includeInvalidated,
            validAt: options.validAt.toISOString(),
            startTime: options.startTime?.toISOString() || null,
            endTime: options.endTime.toISOString(),
            ...(searchTimings && {
              searchTimings: {
                bm25Ms: searchTimings.bm25,
                vectorMs: searchTimings.vector,
                bfsMs: searchTimings.bfs,
                episodeGraphMs: searchTimings.episodeGraph,
              },
            }),
          }),
          source: source ?? "search_api",
          responseTimeMs: responseTime,
          metadata: {
            tokenCount: tokenCount || 0,
          },
          userId,
        },
      });

      logger.debug(
        `Logged recall event for user ${userId}: ${episodeCount} episodes, ${tokenCount} tokens in ${responseTime}ms`,
      );
    } catch (error) {
      logger.error("Error creating recall log entry:", { error });
      // Don't throw - we don't want logging failures to affect the search response
    }
  }

  private async updateRecallCount(
    userId: string,
    episodes: EpisodicNode[],
    statements: StatementNode[],
  ) {
    const episodeIds = episodes.map((episode) => episode.uuid);
    const statementIds = statements.map((statement) => statement.uuid);

    const cypher = `
      MATCH (e:Episode)
      WHERE e.uuid IN $episodeUuids and e.userId = $userId
      SET e.recallCount = coalesce(e.recallCount, 0) + 1
    `;
    await runQuery(cypher, { episodeUuids: episodeIds, userId });

    const cypher2 = `
      MATCH (s:Statement)
      WHERE s.uuid IN $statementUuids and s.userId = $userId
      SET s.recallCount = coalesce(s.recallCount, 0) + 1
    `;
    await runQuery(cypher2, { statementUuids: statementIds, userId });
  }

  /**
   * Format search results as markdown for agent consumption
   */
  private formatAsMarkdown(
    episodes: Array<{
      uuid: string;
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
      rerankScore?: number;
    }>,
    facts: Array<{
      fact: string;
      validAt: Date;
      invalidAt: Date | null;
      relevantScore: number;
    }>,
  ): string {
    const sections: string[] = [];

    // Add episodes/compacts section
    if (episodes.length > 0) {
      sections.push("## Recalled Relevant Context\n");

      episodes.forEach((episode, index) => {
        const date = episode.createdAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        if (episode.isCompact) {
          sections.push(`### 📦 Session Compact`);
          sections.push(`**UUID**: ${episode.uuid}`);
          sections.push(`**Created**: ${date}`);
          if (episode.rerankScore !== undefined) {
            sections.push(`**Relevance**: ${episode.rerankScore}`);
          }
          sections.push(""); // Empty line before content
          sections.push(episode.content);
          sections.push(""); // Empty line
        } else {
          sections.push(`### Episode ${index + 1}`);
          sections.push(`**UUID**: ${episode.uuid}`);
          sections.push(`**Created**: ${date}`);
          if (episode.rerankScore !== undefined) {
            sections.push(`**Relevance**: ${episode.rerankScore}`);
          }
          if (episode.spaceIds.length > 0) {
            sections.push(`**Spaces**: ${episode.spaceIds.join(", ")}`);
          }
          sections.push(""); // Empty line before content
          sections.push(episode.content);
          sections.push(""); // Empty line after
        }
      });
    }

    // Add invalidated facts section (only showing facts that are no longer valid)
    if (facts.length > 0) {
      sections.push("## Invalidated Facts\n");

      facts.forEach((fact) => {
        const validDate = fact.validAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const invalidDate = fact.invalidAt
          ? fact.invalidAt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "";

        sections.push(`- ${fact.fact}`);
        sections.push(`  *Valid: ${validDate} → Invalidated: ${invalidDate}*`);
      });
      sections.push(""); // Empty line after facts
    }

    // Handle empty results
    if (episodes.length === 0 && facts.length === 0) {
      sections.push("*No relevant memories found.*\n");
    }

    return sections.join("\n");
  }

  /**
   * Replace session episodes with compacts, preserving rerank ranking order
   * Takes highest rerank score when multiple episodes from same session
   */
  private async replaceWithCompacts(
    episodesWithScores: (EpisodeWithProvenance & { rerankScore: number })[],
    userId: string,
  ): Promise<Array<{
    uuid: string;
    content: string;
    createdAt: Date;
    spaceIds: string[];
    isCompact?: boolean;
    relevanceScore?: number;
  }>> {
    // Group by sessionId and track highest score per session
    const sessionGroups = new Map<string, {
      episodes: typeof episodesWithScores;
      highestScore: number;
      firstIndex: number;
    }>();

    episodesWithScores.forEach((ep, index) => {
      const sessionId = ep.episode.sessionId;
      if (sessionId && !ep.episode.metadata?.documentUuid) {
        if (!sessionGroups.has(sessionId)) {
          sessionGroups.set(sessionId, {
            episodes: [],
            highestScore: ep.rerankScore || 0,
            firstIndex: index,
          });
        }
        const group = sessionGroups.get(sessionId)!;
        group.episodes.push(ep);
        group.highestScore = Math.max(group.highestScore, ep.rerankScore || 0);
      }
    });

    const compactMap = new Map<string, any>();
    await Promise.all(
      Array.from(sessionGroups.keys()).map(async (sessionId) => {
        const compact = await getCompactedSessionBySessionId(sessionId, userId);
        if (compact) {
          compactMap.set(sessionId, compact);
        }
      })
    );

    // Build result preserving order, using session's highest-scored position
    const result: Array<{
      uuid: string;
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
      relevanceScore?: number;
      originalIndex: number;
    }> = [];

    const processedSessions = new Set<string>();

    episodesWithScores.forEach((ep, index) => {
      const sessionId = ep.episode.sessionId;

      // Session episode
      if (sessionId && !ep.episode.metadata?.documentUuid) {
        if (processedSessions.has(sessionId)) {
          return; // Skip, already added compact
        }

        const compact = compactMap.get(sessionId);
        if (compact) {
          const group = sessionGroups.get(sessionId)!;
          // Collect unique spaceIds from all episodes in this session
          const sessionSpaceIds = Array.from(new Set(
            group.episodes.flatMap(ep => ep.episode.spaceIds || [])
          ));
          result.push({
            uuid: compact.id, // Use compact ID as uuid
            content: compact.summary,
            createdAt: compact.startTime,
            spaceIds: sessionSpaceIds,
            isCompact: true,
            relevanceScore: group.highestScore, // Use highest score from session episodes
            originalIndex: group.firstIndex, // Use position of first episode from this session
          });
          processedSessions.add(sessionId);
          logger.debug(`Replaced session ${sessionId.slice(0, 8)} episodes with compact, score: ${group.highestScore.toFixed(3)}, spaces: ${sessionSpaceIds.join(',')}`);
        } else {
          // No compact, keep episode
          result.push({
            uuid: ep.episode.uuid,
            content: ep.episode.originalContent,
            createdAt: ep.episode.createdAt,
            spaceIds: ep.episode.spaceIds || [],
            relevanceScore: ep.rerankScore,
            originalIndex: index,
          });
        }
      } else {
        // Non-session episode, keep as-is
        result.push({
          uuid: ep.episode.uuid,
          content: ep.episode.originalContent,
          createdAt: ep.episode.createdAt,
          spaceIds: ep.episode.spaceIds || [],
          relevanceScore: ep.rerankScore,
          originalIndex: index,
        });
      }
    });

    // Sort by originalIndex to preserve reranking order
    result.sort((a, b) => a.originalIndex - b.originalIndex);

    // Remove temporary originalIndex field but keep rerankScore
    return result.map(({ originalIndex, ...rest }) => rest);
  }

  /**
   * Extract episodes with provenance tracking from all search sources
   * Deduplicates episodes and tracks which statements came from which source
   */
  private async extractEpisodesWithProvenance(sources: {
    episodeGraph: EpisodeGraphResult[];
    bfs: EpisodeSearchResult[];
    vector: EpisodeSearchResult[];
    bm25: EpisodeSearchResult[];
  }): Promise<EpisodeWithProvenance[]> {
    const episodeMap = new Map<string, EpisodeWithProvenance>();

    // Helper function to merge episode into map
    const mergeEpisode = (
      episode: EpisodicNode,
      score: number,
      source: 'episodeGraph' | 'bfs' | 'vector' | 'bm25',
      statementCount: number,
      topStatements: StatementNode[],
      invalidatedStatements: StatementNode[],
      entityMatches?: number,
    ) => {
      if (!episodeMap.has(episode.uuid)) {
        episodeMap.set(episode.uuid, {
          episode,
          statements: [],
          episodeGraphScore: 0,
          bfsScore: 0,
          vectorScore: 0,
          bm25Score: 0,
          sourceBreakdown: { fromEpisodeGraph: 0, fromBFS: 0, fromVector: 0, fromBM25: 0 },
        });
      }

      const ep = episodeMap.get(episode.uuid)!;

      // Convert score to number (in case it's BigInt from Neo4j)
      const numericScore = typeof score === 'bigint' ? Number(score) : score;
      const numericStatementCount = typeof statementCount === 'bigint' ? Number(statementCount) : statementCount;

      // Set score for this source
      if (source === 'episodeGraph') {
        ep.episodeGraphScore = numericScore;
        ep.sourceBreakdown.fromEpisodeGraph = numericStatementCount;
      } else if (source === 'bfs') {
        ep.bfsScore = numericScore;
        ep.sourceBreakdown.fromBFS = numericStatementCount;
      } else if (source === 'vector') {
        ep.vectorScore = numericScore;
        ep.sourceBreakdown.fromVector = numericStatementCount;
      } else if (source === 'bm25') {
        ep.bm25Score = numericScore;
        ep.sourceBreakdown.fromBM25 = numericStatementCount;
      }

      // Store top statements and invalidated statements (merge, avoid duplicates)
      const existingUuids = new Set(ep.statements.map(s => s.statement.uuid));

      topStatements.forEach(stmt => {
        if (!existingUuids.has(stmt.uuid)) {
          ep.statements.push({
            statement: stmt,
            sources: source === 'episodeGraph' && entityMatches
              ? { episodeGraph: { score: numericScore, entityMatches } }
              : { [source]: { score: numericScore } },
            primarySource: source,
          });
          existingUuids.add(stmt.uuid);
        }
      });

      // Also include invalidated statements (needed for final response)
      invalidatedStatements.forEach(stmt => {
        if (!existingUuids.has(stmt.uuid)) {
          ep.statements.push({
            statement: stmt,
            sources: { [source]: { score: numericScore } },
            primarySource: source,
          });
          existingUuids.add(stmt.uuid);
        }
      });
    };

    // Process Episode Graph results
    sources.episodeGraph.forEach((result) => {
      mergeEpisode(
        result.episode,
        result.score,
        'episodeGraph',
        result.statements.length,
        result.statements,
        result.statements.filter(s => s.invalidAt !== null),
        result.metrics.entityMatchCount,
      );
    });

    // Process BFS results (episodes already grouped by Neo4j!)
    sources.bfs.forEach((result) => {
      mergeEpisode(
        result.episode,
        result.score,
        'bfs',
        result.statementCount,
        result.topStatements,
        result.invalidatedStatements,
      );
    });

    // Process Vector results (episodes already grouped by Neo4j!)
    sources.vector.forEach((result) => {
      mergeEpisode(
        result.episode,
        result.score,
        'vector',
        result.statementCount,
        result.topStatements,
        result.invalidatedStatements,
      );
    });

    // Process BM25 results (episodes already grouped by Neo4j!)
    sources.bm25.forEach((result) => {
      mergeEpisode(
        result.episode,
        result.score,
        'bm25',
        result.statementCount,
        result.topStatements,
        result.invalidatedStatements,
      );
    });

    logger.info(`Merged ${episodeMap.size} unique episodes from all sources`);

    return Array.from(episodeMap.values());
  }

  /**
   * Batch-fetch entity match counts for all episodes
   * Counts how many query entities match entities in each episode
   */
  private async fetchEntityMatchCounts(
    episodes: EpisodeWithProvenance[],
    queryEntityIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    if (queryEntityIds.length === 0 || episodes.length === 0) {
      return new Map();
    }

    const episodeIds = episodes.map(ep => ep.episode.uuid);

    // Single efficient Cypher query to count entity matches for all episodes
    const cypher = `
      // Match episodes and their statements
      MATCH (ep:Episode {userId: $userId})
      WHERE ep.uuid IN $episodeIds

      // Find all entities connected to episode statements
      MATCH (ep)-[:HAS_PROVENANCE]->(s:Statement)-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(entity:Entity {userId: $userId})
      WHERE entity.uuid IN $queryEntityIds

      // Count distinct matching entities per episode
      WITH ep.uuid as episodeId, collect(DISTINCT entity.uuid) as matchedEntities
      RETURN episodeId, size(matchedEntities) as entityMatchCount
    `;

    const params = {
      episodeIds,
      queryEntityIds,
      userId,
    };

    const records = await runQuery(cypher, params);

    const matchCounts = new Map<string, number>();
    records.forEach((record) => {
      const episodeId = record.get("episodeId");
      const count = typeof record.get("entityMatchCount") === 'bigint'
        ? Number(record.get("entityMatchCount"))
        : record.get("entityMatchCount");
      matchCounts.set(episodeId, count);
    });

    // Calculate total matches (ensure all values are numbers)
    const totalMatches = Array.from(matchCounts.values()).reduce((sum, count) => {
      return sum + (typeof count === 'number' ? count : Number(count));
    }, 0);

    logger.info(
      `Fetched entity match counts for ${matchCounts.size}/${episodes.length} episodes ` +
      `(${totalMatches} total matches)`
    );

    return matchCounts;
  }
}