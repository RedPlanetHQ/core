import type { EntityNode, EpisodicNode, StatementNode } from "@core/types";
import { logger } from "./logger.service";
import {
  performBfsSearch,
  performBM25Search,
  performVectorSearch,
  performEpisodeGraphSearch,
  extractEntitiesFromQuery,
  type EpisodeGraphResult,
} from "./search/utils";
import { getEmbedding, makeModelCall } from "~/lib/model.server";
import { prisma } from "~/db.server";
import { runQuery } from "~/lib/neo4j.server";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

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
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
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
      limit: options.limit || 20, // Maximum episodes in final response
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
    const episodesWithProvenance = await this.extractEpisodesWithProvenance({
      episodeGraph: episodeGraphResults,
      bfs: bfsResults,
      vector: vectorResults,
      bm25: bm25Results,
    });

    logger.info(`Extracted ${episodesWithProvenance.length} unique episodes from all sources`);

    // Stage 1.5: Add entity match counts and filter by minimum entity matches
    const episodesWithEntityCounts = await this.addEntityMatchCounts(
      episodesWithProvenance,
      entities,
      userId
    );
    const entityFilteredEpisodes = this.filterByEntityMatches(episodesWithEntityCounts, entities.length);

    logger.info(
      `Entity filtering: ${entityFilteredEpisodes.length}/${episodesWithProvenance.length} episodes kept ` +
      `(${entities.length} query entities extracted)`
    );

    // Stage 2: Rate episodes by source hierarchy (EpisodeGraph > BFS > Vector > BM25)
    const ratedEpisodes = this.rateEpisodesBySource(entityFilteredEpisodes);

    // Stage 3: Filter by quality (not by model capability)
    const qualityThreshold = opts.qualityThreshold || QUALITY_THRESHOLDS.HIGH_QUALITY_EPISODE;
    const qualityFilter = this.filterByQuality(ratedEpisodes, query, qualityThreshold);

    // If no high-quality matches, return empty
    if (qualityFilter.confidence < QUALITY_THRESHOLDS.NO_RESULT) {
      logger.warn(`Low confidence (${qualityFilter.confidence.toFixed(2)}) for query: "${query}"`);
      return opts.structured
        ? {
            episodes: [],
            invalidatedFacts: [],
          }
        : this.formatAsMarkdown([], []);
    }

    // Stage 4: Optional LLM validation for borderline confidence
    let finalEpisodes = qualityFilter.episodes;
    const useLLMValidation = opts.useLLMValidation || false;

    if (
      useLLMValidation &&
      qualityFilter.confidence >= QUALITY_THRESHOLDS.UNCERTAIN_RESULT &&
      qualityFilter.confidence < QUALITY_THRESHOLDS.CONFIDENT_RESULT
    ) {
      logger.info(
        `Borderline confidence (${qualityFilter.confidence.toFixed(2)}), using LLM validation`,
      );

      const maxEpisodesForLLM = opts.maxEpisodesForLLM || 20;
      finalEpisodes = await this.validateEpisodesWithLLM(
        query,
        qualityFilter.episodes,
        maxEpisodesForLLM,
      );

      if (finalEpisodes.length === 0) {
        logger.info('LLM validation rejected all episodes, returning empty');
        return opts.structured ? { episodes: [], invalidatedFacts: [] } : this.formatAsMarkdown([], []);
      }
    }

    // Apply limit to final episodes
    const limitedEpisodes = finalEpisodes.slice(0, opts.limit);

    if (finalEpisodes.length > opts.limit) {
      logger.warn(
        `Limiting episodes from ${finalEpisodes.length} to ${opts.limit} (limit option)`
      );
    }

    // Extract episodes and statements for response
    const episodes = limitedEpisodes.map((ep) => ep.episode);
    const filteredResults = limitedEpisodes.flatMap((ep) =>
      ep.statements.map((s) => ({
        statement: s.statement,
        score: Number((ep.firstLevelScore || 0).toFixed(2)),
      })),
    );

    logger.info(
      `Final results: ${episodes.length} episodes, ${filteredResults.length} statements, ` +
        `confidence: ${qualityFilter.confidence.toFixed(2)}`,
    );

    // Replace session episodes with compacts automatically
    const unifiedEpisodes = await this.replaceWithCompacts(episodes, userId);

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
      episodes,
      filteredResults.map((item) => item.statement),
    );

    this.logRecallAsync(
      query,
      userId,
      episodes.length,
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
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
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
          sections.push(`**Created**: ${date}\n`);
          sections.push(episode.content);
          sections.push(""); // Empty line
        } else {
          sections.push(`### Episode ${index + 1}`);
          sections.push(`**Created**: ${date}`);
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
   * Replace session episodes with their compacted sessions
   * Returns unified array with both regular episodes and compacts
   */
  private async replaceWithCompacts(
    episodes: EpisodicNode[],
    userId: string,
  ): Promise<Array<{
    content: string;
    createdAt: Date;
    spaceIds: string[];
    isCompact?: boolean;
  }>> {
    // Group episodes by sessionId
    const sessionEpisodes = new Map<string, EpisodicNode[]>();
    const nonSessionEpisodes: EpisodicNode[] = [];

    for (const episode of episodes) {
      // Skip episodes with documentId (these are document chunks, not session episodes)
      if (episode.metadata?.documentUuid) {
        nonSessionEpisodes.push(episode);
        continue;
      }

      // Episodes with sessionId - group them
      if (episode.sessionId) {
        if (!sessionEpisodes.has(episode.sessionId)) {
          sessionEpisodes.set(episode.sessionId, []);
        }
        sessionEpisodes.get(episode.sessionId)!.push(episode);
      } else {
        // No sessionId - keep as regular episode
        nonSessionEpisodes.push(episode);
      }
    }

    // Build unified result array
    const result: Array<{
      content: string;
      createdAt: Date;
      spaceIds: string[];
      isCompact?: boolean;
      episodeUuid: string;
    }> = [];

    // Add non-session episodes first
    for (const episode of nonSessionEpisodes) {
      result.push({
        content: episode.originalContent,
        createdAt: episode.createdAt,
        spaceIds: episode.spaceIds || [],
        episodeUuid: episode.uuid,
      });
    }

    // Check each session for compacts
    const { getCompactedSessionBySessionId } = await import(
      "~/services/graphModels/compactedSession"
    );

    const sessionIds = Array.from(sessionEpisodes.keys());

    for (const sessionId of sessionIds) {
      const sessionEps = sessionEpisodes.get(sessionId)!;
      const compact = await getCompactedSessionBySessionId(sessionId, userId);

      if (compact) {
        // Compact exists - add compact as episode, skip original episodes
        result.push({
          content: compact.summary,
          createdAt: compact.startTime, // Use session start time
          spaceIds: [], // Compacts don't have spaceIds directly
          isCompact: true,
          episodeUuid: compact.uuid,
        });

        logger.info(`Replaced ${sessionEps.length} episodes with compact`, {
          sessionId,
          episodeCount: sessionEps.length,
        });
      } else {
        // No compact - add original episodes
        for (const episode of sessionEps) {
          result.push({
            content: episode.originalContent,
            createdAt: episode.createdAt,
            spaceIds: episode.spaceIds || [],
            episodeUuid: episode.uuid,
          });
        }
      }
    }

    return result;
  }

  /**
   * Add entity match counts to episodes by querying all entities in each episode
   * Uses batch query for efficiency
   */
  private async addEntityMatchCounts(
    episodes: EpisodeWithProvenance[],
    queryEntities: EntityNode[],
    userId: string
  ): Promise<EpisodeWithProvenanceAndEntityCount[]> {
    // If no query entities, skip entity counting
    if (queryEntities.length === 0) {
      logger.info('No query entities - skipping entity match counting');
      return episodes.map(ep => ({ ...ep, entityMatchCount: 0 }));
    }

    // If no episodes, return empty
    if (episodes.length === 0) {
      return [];
    }

    const queryEntityIds = new Set(queryEntities.map(e => e.uuid));
    const episodeUuids = episodes.map(ep => ep.episode.uuid);

    logger.info(`Fetching entities for ${episodeUuids.length} episodes to calculate match counts`);

    // Batch query to get all entities for all episodes
    const cypher = `
      UNWIND $episodeUuids AS epUuid
      MATCH (ep:Episode {uuid: epUuid, userId: $userId})-[provRel:HAS_PROVENANCE]->(s:Statement)
      MATCH (s)-[entityRel:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]->(entity:Entity)
      WHERE entity.userId = $userId
      RETURN ep.uuid as episodeUuid, COLLECT(DISTINCT entity.uuid) as entityUuids
    `;

    const records = await runQuery(cypher, { episodeUuids, userId });

    // Build map of episode UUID -> entity UUIDs
    const episodeEntityMap = new Map<string, string[]>();
    records.forEach(record => {
      const episodeUuid = record.get('episodeUuid');
      const entityUuids = record.get('entityUuids') || [];
      episodeEntityMap.set(episodeUuid, entityUuids);
    });

    // Calculate entity match count for each episode
    const episodesWithCounts = episodes.map(ep => {
      const episodeEntities = episodeEntityMap.get(ep.episode.uuid) || [];
      const matchCount = episodeEntities.filter(entityId => queryEntityIds.has(entityId)).length;

      return {
        ...ep,
        entityMatchCount: matchCount,
      };
    });

    logger.info(
      `Entity match counts calculated: ` +
      `avg=${(episodesWithCounts.reduce((sum, ep) => sum + ep.entityMatchCount, 0) / episodesWithCounts.length).toFixed(1)}, ` +
      `max=${Math.max(...episodesWithCounts.map(ep => ep.entityMatchCount))}, ` +
      `min=${Math.min(...episodesWithCounts.map(ep => ep.entityMatchCount))}`
    );

    return episodesWithCounts;
  }

  /**
   * Filter episodes by minimum entity match count
   * Strategy:
   * - If 1 query entity: require at least 1 match
   * - If 2+ query entities: require at least 1 match (can adjust threshold later)
   * - If no query entities: keep all (fallback to semantic/keyword search)
   */
  private filterByEntityMatches(
    episodes: EpisodeWithProvenanceAndEntityCount[],
    queryEntityCount: number
  ): EpisodeWithProvenanceAndEntityCount[] {
    // If no entities extracted, skip entity filtering
    if (queryEntityCount === 0) {
      logger.info('No query entities - skipping entity match filtering');
      return episodes;
    }

    // Require at least 1 entity match
    const minEntityMatches = 1;

    const filtered = episodes.filter(ep => ep.entityMatchCount >= minEntityMatches);

    // Log episodes that were filtered out
    const filteredOut = episodes.filter(ep => ep.entityMatchCount < minEntityMatches);
    if (filteredOut.length > 0) {
      logger.info(
        `Filtered out ${filteredOut.length} episodes with <${minEntityMatches} entity matches:\n` +
        filteredOut.slice(0, 5).map(ep =>
          `  - Episode ${ep.episode.uuid.slice(0, 8)}: ${ep.entityMatchCount} matches, ` +
          `first-level-score would be: ${ep.firstLevelScore?.toFixed(2) || 'N/A'}, ` +
          `sources: EG=${ep.sourceBreakdown.fromEpisodeGraph}, BFS=${ep.sourceBreakdown.fromBFS}, ` +
          `Vec=${ep.sourceBreakdown.fromVector}, BM25=${ep.sourceBreakdown.fromBM25}`
        ).join('\n')
      );
    }

    // Log kept episodes with their match counts
    if (filtered.length > 0) {
      logger.info(
        `Kept ${filtered.length} episodes with >=${minEntityMatches} entity matches (top 5):\n` +
        filtered.slice(0, 5).map(ep =>
          `  - Episode ${ep.episode.uuid.slice(0, 8)}: ${ep.entityMatchCount} matches, ` +
          `sources: EG=${ep.sourceBreakdown.fromEpisodeGraph}, BFS=${ep.sourceBreakdown.fromBFS}, ` +
          `Vec=${ep.sourceBreakdown.fromVector}, BM25=${ep.sourceBreakdown.fromBM25}`
        ).join('\n')
      );
    }

    return filtered;
  }

  /**
   * Extract episodes with provenance tracking from all search sources
   * Deduplicates episodes and tracks which statements came from which source
   */
  private async extractEpisodesWithProvenance(sources: {
    episodeGraph: EpisodeGraphResult[];
    bfs: import("./search/utils").EpisodeSearchResult[];
    vector: import("./search/utils").EpisodeSearchResult[];
    bm25: import("./search/utils").EpisodeSearchResult[];
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

      // Set score for this source
      if (source === 'episodeGraph') {
        ep.episodeGraphScore = score;
        ep.sourceBreakdown.fromEpisodeGraph = statementCount;
      } else if (source === 'bfs') {
        ep.bfsScore = score;
        ep.sourceBreakdown.fromBFS = statementCount;
      } else if (source === 'vector') {
        ep.vectorScore = score;
        ep.sourceBreakdown.fromVector = statementCount;
      } else if (source === 'bm25') {
        ep.bm25Score = score;
        ep.sourceBreakdown.fromBM25 = statementCount;
      }

      // Store top statements and invalidated statements (merge, avoid duplicates)
      const existingUuids = new Set(ep.statements.map(s => s.statement.uuid));

      topStatements.forEach(stmt => {
        if (!existingUuids.has(stmt.uuid)) {
          ep.statements.push({
            statement: stmt,
            sources: source === 'episodeGraph' && entityMatches
              ? { episodeGraph: { score, entityMatches } }
              : { [source]: { score } },
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
            sources: { [source]: { score } },
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
   * Rate episodes by source hierarchy: Episode Graph > BFS > Vector > BM25
   * Now also boosts episodes by entity match count
   */
  private rateEpisodesBySource(
    episodes: EpisodeWithProvenanceAndEntityCount[]
  ): EpisodeWithProvenanceAndEntityCount[] {
    return episodes
      .map((ep) => {
        // Hierarchical scoring: EpisodeGraph > BFS > Vector > BM25
        let firstLevelScore = 0;

        // Episode Graph: Highest weight (5.0)
        if (ep.episodeGraphScore > 0) {
          firstLevelScore += ep.episodeGraphScore * 5.0;
        }

        // BFS: Second highest (3.0), already hop-weighted in extraction
        if (ep.bfsScore > 0) {
          firstLevelScore += ep.bfsScore * 3.0;
        }

        // Vector: Third (1.5)
        if (ep.vectorScore > 0) {
          firstLevelScore += ep.vectorScore * 1.5;
        }

        // BM25: Lowest (0.2), only significant if others missing
        // Reduced from 0.5 to 0.2 to prevent keyword noise from dominating
        if (ep.bm25Score > 0) {
          firstLevelScore += ep.bm25Score * 0.2;
        }

        // Concentration bonus: More statements = higher confidence
        const concentrationBonus = Math.log(1 + ep.statements.length) * 0.3;
        firstLevelScore *= 1 + concentrationBonus;

        // Entity match boost: More matching entities = higher relevance
        // Multiplicative boost to ensure episodes with more entity matches rank significantly higher
        const entityMatchMultiplier = 1 + (ep.entityMatchCount * 0.5);
        firstLevelScore *= entityMatchMultiplier;

        logger.debug(
          `Episode ${ep.episode.uuid.slice(0, 8)}: ` +
          `baseScore=${(firstLevelScore / entityMatchMultiplier).toFixed(2)}, ` +
          `entityMatches=${ep.entityMatchCount}, ` +
          `multiplier=${entityMatchMultiplier.toFixed(2)}, ` +
          `finalScore=${firstLevelScore.toFixed(2)}`
        );

        return {
          ...ep,
          firstLevelScore,
        };
      })
      .sort((a, b) => (b.firstLevelScore || 0) - (a.firstLevelScore || 0));
  }

  /**
   * Filter episodes by quality, not by model capability
   * Returns empty if no high-quality matches found
   */
  private filterByQuality(
    ratedEpisodes: EpisodeWithProvenanceAndEntityCount[],
    query: string,
    baseQualityThreshold: number = QUALITY_THRESHOLDS.HIGH_QUALITY_EPISODE,
  ): QualityFilterResult {
    // Adaptive threshold based on available sources
    // This prevents filtering out ALL results when only Vector/BM25 are available
    const hasEpisodeGraph = ratedEpisodes.some((ep) => ep.episodeGraphScore > 0);
    const hasBFS = ratedEpisodes.some((ep) => ep.bfsScore > 0);
    const hasVector = ratedEpisodes.some((ep) => ep.vectorScore > 0);
    const hasBM25 = ratedEpisodes.some((ep) => ep.bm25Score > 0);

    let qualityThreshold: number;

    if (hasEpisodeGraph || hasBFS) {
      // Graph-based results available - use high threshold (5.0)
      // Max possible score with Episode Graph: ~10+ (5.0 * 2.0)
      // Max possible score with BFS: ~6+ (2.0 * 3.0)
      qualityThreshold = 5.0;
    } else if (hasVector) {
      // Only semantic vector search - use medium threshold (1.0)
      // Max possible score with Vector: ~1.5 (1.0 * 1.5)
      qualityThreshold = 1.0;
    } else if (hasBM25) {
      // Only keyword BM25 - use low threshold (0.3)
      // Max possible score with BM25: ~0.5 (1.0 * 0.5)
      qualityThreshold = 0.3;
    } else {
      // No results at all
      logger.warn(`No results from any source for query: "${query}"`);
      return {
        episodes: [],
        confidence: 0,
        message: 'No relevant information found in memory',
      };
    }

    logger.info(
      `Adaptive quality threshold: ${qualityThreshold.toFixed(1)} ` +
        `(EpisodeGraph: ${hasEpisodeGraph}, BFS: ${hasBFS}, Vector: ${hasVector}, BM25: ${hasBM25})`,
    );

    // 1. Filter to high-quality episodes only
    const highQualityEpisodes = ratedEpisodes.filter(
      (ep) => (ep.firstLevelScore || 0) >= qualityThreshold,
    );

    if (highQualityEpisodes.length === 0) {
      logger.info(`No high-quality matches for query: "${query}" (threshold: ${qualityThreshold})`);
      return {
        episodes: [],
        confidence: 0,
        message: 'No relevant information found in memory',
      };
    }

    // 2. Apply score gap detection to find natural cutoff
    const scores = highQualityEpisodes.map((ep) => ep.firstLevelScore || 0);
    const gapCutoff = this.findScoreGapForEpisodes(scores);

    // 3. Take episodes up to the gap
    const filteredEpisodes = highQualityEpisodes.slice(0, gapCutoff);

    // 4. Calculate overall confidence with adaptive normalization
    const confidence = this.calculateConfidence(filteredEpisodes);

    logger.info(
      `Quality filtering: ${filteredEpisodes.length}/${ratedEpisodes.length} episodes kept, ` +
        `confidence: ${confidence.toFixed(2)}`,
    );

    return {
      episodes: filteredEpisodes,
      confidence,
      message: `Found ${filteredEpisodes.length} relevant episodes`,
    };
  }

  /**
   * Calculate confidence score with adaptive normalization
   * Uses different max expected scores based on DOMINANT source (not just presence)
   *
   * IMPORTANT: BM25 is NEVER considered dominant - it's a fallback, not a quality signal.
   * When only Vector+BM25 exist, Vector is dominant.
   */
  private calculateConfidence(filteredEpisodes: EpisodeWithProvenanceAndEntityCount[]): number {
    if (filteredEpisodes.length === 0) return 0;

    const avgScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.firstLevelScore || 0), 0) /
      filteredEpisodes.length;

    // Calculate average contribution from each source (weighted)
    const avgEpisodeGraphScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.episodeGraphScore || 0), 0) /
      filteredEpisodes.length;

    const avgBFSScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.bfsScore || 0), 0) /
      filteredEpisodes.length;

    const avgVectorScore =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.vectorScore || 0), 0) /
      filteredEpisodes.length;

    const avgBM25Score =
      filteredEpisodes.reduce((sum, ep) => sum + (ep.bm25Score || 0), 0) /
      filteredEpisodes.length;

    // Determine which source is dominant (weighted contribution to final score)
    // BM25 is EXCLUDED from dominant source detection - it's a fallback mechanism
    const episodeGraphContribution = avgEpisodeGraphScore * 5.0;
    const bfsContribution = avgBFSScore * 3.0;
    const vectorContribution = avgVectorScore * 1.5;
    const bm25Contribution = avgBM25Score * 0.2;

    let maxExpectedScore: number;
    let dominantSource: string;

    if (
      episodeGraphContribution > bfsContribution &&
      episodeGraphContribution > vectorContribution
    ) {
      // Episode Graph is dominant source
      maxExpectedScore = 25; // Typical range: 10-30
      dominantSource = 'EpisodeGraph';
    } else if (bfsContribution > vectorContribution) {
      // BFS is dominant source
      maxExpectedScore = 15; // Typical range: 5-15
      dominantSource = 'BFS';
    } else if (vectorContribution > 0) {
      // Vector is dominant source (even if BM25 contribution is higher)
      maxExpectedScore = 3; // Typical range: 1-3
      dominantSource = 'Vector';
    } else {
      // ONLY BM25 results (Vector=0, BFS=0, EpisodeGraph=0)
      // This should be rare and indicates low-quality keyword-only matches
      maxExpectedScore = 1; // Typical range: 0.3-1
      dominantSource = 'BM25';
    }

    const confidence = Math.min(1.0, avgScore / maxExpectedScore);

    logger.info(
      `Confidence: avgScore=${avgScore.toFixed(2)}, maxExpected=${maxExpectedScore}, ` +
        `confidence=${confidence.toFixed(2)}, dominantSource=${dominantSource} ` +
        `(Contributions: EG=${episodeGraphContribution.toFixed(2)}, ` +
        `BFS=${bfsContribution.toFixed(2)}, Vec=${vectorContribution.toFixed(2)}, ` +
        `BM25=${bm25Contribution.toFixed(2)})`,
    );

    return confidence;
  }

  /**
   * Find score gap in episode scores (similar to statement gap detection)
   */
  private findScoreGapForEpisodes(scores: number[], minResults: number = 3): number {
    if (scores.length <= minResults) {
      return scores.length;
    }

    // Find largest relative gap after minResults
    for (let i = minResults - 1; i < scores.length - 1; i++) {
      const currentScore = scores[i];
      const nextScore = scores[i + 1];

      if (currentScore === 0) break;

      const gap = currentScore - nextScore;
      const relativeGap = gap / currentScore;

      // If we find a cliff (>50% drop), cut there
      if (relativeGap > QUALITY_THRESHOLDS.MINIMUM_GAP_RATIO) {
        logger.info(
          `Episode gap detected at position ${i}: ${currentScore.toFixed(3)} → ${nextScore.toFixed(3)} ` +
            `(${(relativeGap * 100).toFixed(1)}% drop)`,
        );
        return i + 1; // Return count (index + 1)
      }
    }

    logger.info(`No significant gap found in episode scores`);

    // No significant gap found, return all
    return scores.length;
  }

  /**
   * Validate episodes with LLM for borderline confidence cases
   * Only used when confidence is between 0.3 and 0.7
   */
  private async validateEpisodesWithLLM(
    query: string,
    episodes: EpisodeWithProvenanceAndEntityCount[],
    maxEpisodes: number = 20,
  ): Promise<EpisodeWithProvenanceAndEntityCount[]> {
    const candidatesForValidation = episodes.slice(0, maxEpisodes);

    const prompt = `Given user query, validate which episodes are truly relevant.

Query: "${query}"

Episodes (showing episode metadata and top statements):
${candidatesForValidation
  .map(
    (ep, i) => `
${i + 1}. Episode: ${ep.episode.content || 'Untitled'} (${new Date(ep.episode.createdAt).toLocaleDateString()})
   First-level score: ${ep.firstLevelScore?.toFixed(2)}
   Sources: ${ep.sourceBreakdown.fromEpisodeGraph} EpisodeGraph, ${ep.sourceBreakdown.fromBFS} BFS, ${ep.sourceBreakdown.fromVector} Vector, ${ep.sourceBreakdown.fromBM25} BM25
   Total statements: ${ep.statements.length}

   Top statements:
${ep.statements
  .slice(0, 5)
  .map((s, idx) => `   ${idx + 1}) ${s.statement.fact}`)
  .join('\n')}
`,
  )
  .join('\n')}

Task: Validate which episodes DIRECTLY answer the query intent.

IMPORTANT RULES:
1. ONLY include episodes that contain information directly relevant to answering the query
2. If NONE of the episodes answer the query, return an empty array: []
3. Do NOT include episodes just because they share keywords with the query
4. Consider source quality: EpisodeGraph > BFS > Vector > BM25

Examples:
- Query "what is user name?" → Only include episodes that explicitly state a user's name
- Query "user home address" → Only include episodes with actual address information
- Query "random keywords" → Return [] if no episodes match semantically

Output format:
<output>
{
  "valid_episodes": [1, 3, 5]
}
</output>

If NO episodes are relevant to the query, return:
<output>
{
  "valid_episodes": []
}
</output>`;

    try {
      let responseText = '';
      await makeModelCall(
        false,
        [{ role: 'user', content: prompt }],
        (text) => {
          responseText = text;
        },
        { temperature: 0.2, maxTokens: 500 },
        'low', 
      );

      // Parse LLM response
      const outputMatch = /<output>([\s\S]*?)<\/output>/i.exec(responseText);
      if (!outputMatch?.[1]) {
        logger.warn('LLM validation returned no output, using all episodes');
        return episodes;
      }

      const result = JSON.parse(outputMatch[1]);
      const validIndices = result.valid_episodes || [];

      if (validIndices.length === 0) {
        logger.info('LLM validation: No episodes deemed relevant');
        return [];
      }

      logger.info(`LLM validation: ${validIndices.length}/${candidatesForValidation.length} episodes validated`);

      // Return validated episodes
      return validIndices.map((idx: number) => candidatesForValidation[idx - 1]).filter(Boolean);
    } catch (error) {
      logger.error('LLM validation failed:', { error });
      // Fallback: return original episodes
      return episodes;
    }
  }

}

/**
 * Search options interface
 */
export interface SearchOptions {
  limit?: number;
  maxBfsDepth?: number;
  validAt?: Date;
  startTime?: Date | null;
  endTime?: Date;
  includeInvalidated?: boolean;
  entityTypes?: string[];
  predicateTypes?: string[];
  scoreThreshold?: number;
  minResults?: number;
  spaceIds?: string[]; // Filter results by specific spaces
  adaptiveFiltering?: boolean;
  structured?: boolean; // Return structured JSON instead of markdown (default: false)
  useLLMValidation?: boolean; // Use LLM to validate episodes for borderline confidence cases (default: false)
  qualityThreshold?: number; // Minimum episode score to be considered high-quality (default: 5.0)
  maxEpisodesForLLM?: number; // Maximum episodes to send for LLM validation (default: 20)
}

/**
 * Statement with source provenance tracking
 */
interface StatementWithSource {
  statement: StatementNode;
  sources: {
    episodeGraph?: { score: number; entityMatches: number };
    bfs?: { score: number; hopDistance: number; relevance: number };
    vector?: { score: number; similarity: number };
    bm25?: { score: number; rank: number };
  };
  primarySource: 'episodeGraph' | 'bfs' | 'vector' | 'bm25';
}

/**
 * Episode with provenance tracking from multiple sources
 */
interface EpisodeWithProvenance {
  episode: EpisodicNode;
  statements: StatementWithSource[];

  // Aggregated scores from each source
  episodeGraphScore: number;
  bfsScore: number;
  vectorScore: number;
  bm25Score: number;

  // Source distribution
  sourceBreakdown: {
    fromEpisodeGraph: number;
    fromBFS: number;
    fromVector: number;
    fromBM25: number;
  };

  // First-level rating score (hierarchical)
  firstLevelScore?: number;
}

/**
 * Episode with provenance tracking AND entity match count
 */
interface EpisodeWithProvenanceAndEntityCount extends EpisodeWithProvenance {
  entityMatchCount: number;
}

/**
 * Quality filtering result
 */
interface QualityFilterResult {
  episodes: EpisodeWithProvenanceAndEntityCount[];
  confidence: number;
  message: string;
}

/**
 * Quality thresholds for filtering
 */
const QUALITY_THRESHOLDS = {
  // Adaptive episode-level scoring (based on available sources)
  HIGH_QUALITY_EPISODE: 5.0,      // For Episode Graph or BFS results (max score ~10+)
  MEDIUM_QUALITY_EPISODE: 1.0,    // For Vector-only results (max score ~1.5)
  LOW_QUALITY_EPISODE: 0.3,       // For BM25-only results (max score ~0.5)

  // Overall result confidence
  CONFIDENT_RESULT: 0.7,          // High confidence, skip LLM validation
  UNCERTAIN_RESULT: 0.3,          // Borderline, use LLM validation
  NO_RESULT: 0.3,                 // Too low, return empty

  // Score gap detection
  MINIMUM_GAP_RATIO: 0.5,         // 50% score drop = gap
};
