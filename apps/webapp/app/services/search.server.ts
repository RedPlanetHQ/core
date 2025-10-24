import type { EntityNode, EpisodicNode, StatementNode } from "@core/types";
import { logger } from "./logger.service";
import {
  performBfsSearch,
  performBM25Search,
  performVectorSearch,
  performEpisodeGraphSearch,
  extractEntitiesFromQuery,
  groupStatementsByEpisode,
  getEpisodesByUuids,
  type EpisodeGraphResult,
} from "./search/utils";
import { getEmbedding, makeModelCall } from "~/lib/model.server";
import { prisma } from "~/db.server";
import { runQuery } from "~/lib/neo4j.server";

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
    facts: {
      fact: string;
      validAt: Date;
      invalidAt: Date | null;
      relevantScore: number;
    }[];
  }> {
    const startTime = Date.now();
    // Default options

    const opts: Required<SearchOptions> = {
      limit: options.limit || 100,
      maxBfsDepth: options.maxBfsDepth || 4,
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
    const [bm25Results, vectorResults, bfsResults, episodeGraphResults] = await Promise.all([
      performBM25Search(query, userId, opts),
      performVectorSearch(queryVector, userId, opts),
      performBfsSearch(query, queryVector, userId, entities, opts),
      performEpisodeGraphSearch(query, entities, queryVector, userId, opts),
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

    // Stage 2: Rate episodes by source hierarchy (EpisodeGraph > BFS > Vector > BM25)
    const ratedEpisodes = this.rateEpisodesBySource(episodesWithProvenance);

    // Stage 3: Filter by quality (not by model capability)
    const qualityThreshold = opts.qualityThreshold || QUALITY_THRESHOLDS.HIGH_QUALITY_EPISODE;
    const qualityFilter = this.filterByQuality(ratedEpisodes, query, qualityThreshold);

    // If no high-quality matches, return empty
    if (qualityFilter.confidence < QUALITY_THRESHOLDS.NO_RESULT) {
      logger.warn(`Low confidence (${qualityFilter.confidence.toFixed(2)}) for query: "${query}"`);
      return opts.structured
        ? {
            episodes: [],
            facts: [],
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
        return opts.structured ? { episodes: [], facts: [] } : this.formatAsMarkdown([], []);
      }
    }

    // Extract episodes and statements for response
    const episodes = finalEpisodes.map((ep) => ep.episode);
    const filteredResults = finalEpisodes.flatMap((ep) =>
      ep.statements.map((s) => ({
        statement: s.statement,
        score: Number((ep.firstLevelScore || 0).toFixed(2)),
      })),
    );

    logger.info(
      `Final results: ${episodes.length} episodes, ${filteredResults.length} statements, ` +
        `confidence: ${qualityFilter.confidence.toFixed(2)}`,
    );

    // Log recall asynchronously (don't await to avoid blocking response)
    const responseTime = Date.now() - startTime;
    this.logRecallAsync(
      query,
      userId,
      filteredResults.map((item) => item.statement),
      opts,
      responseTime,
      source,
    ).catch((error) => {
      logger.error("Failed to log recall event:", error);
    });

    this.updateRecallCount(
      userId,
      episodes,
      filteredResults.map((item) => item.statement),
    );

    // Replace session episodes with compacts automatically
    const unifiedEpisodes = await this.replaceWithCompacts(episodes, userId);

    const factsData = filteredResults.map((statement) => ({
      fact: statement.statement.fact,
      validAt: statement.statement.validAt,
      invalidAt: statement.statement.invalidAt || null,
      relevantScore: statement.score,
    }));

    // Return markdown by default, structured JSON if requested
    if (opts.structured) {
      return {
        episodes: unifiedEpisodes,
        facts: factsData,
      };
    }

    // Return markdown formatted context
    return this.formatAsMarkdown(unifiedEpisodes, factsData);
  }

  private async logRecallAsync(
    query: string,
    userId: string,
    results: StatementNode[],
    options: Required<SearchOptions>,
    responseTime: number,
    source?: string,
  ): Promise<void> {
    try {
      // Determine target type based on results
      let targetType = "mixed_results";
      if (results.length === 1) {
        targetType = "statement";
      } else if (results.length === 0) {
        targetType = "no_results";
      }

      // Calculate average similarity score if available
      let averageSimilarityScore: number | null = null;
      const scoresWithValues = results
        .map((result) => {
          // Try to extract score from various possible score fields
          const score =
            (result as any).rrfScore ||
            (result as any).mmrScore ||
            (result as any).crossEncoderScore ||
            (result as any).finalScore ||
            (result as any).score;
          return score && typeof score === "number" ? score : null;
        })
        .filter((score): score is number => score !== null);

      if (scoresWithValues.length > 0) {
        averageSimilarityScore =
          scoresWithValues.reduce((sum, score) => sum + score, 0) /
          scoresWithValues.length;
      }

      await prisma.recallLog.create({
        data: {
          accessType: "search",
          query,
          targetType,
          searchMethod: "hybrid", // BM25 + Vector + BFS
          minSimilarity: options.scoreThreshold,
          maxResults: options.limit,
          resultCount: results.length,
          similarityScore: averageSimilarityScore,
          context: JSON.stringify({
            entityTypes: options.entityTypes,
            predicateTypes: options.predicateTypes,
            maxBfsDepth: options.maxBfsDepth,
            includeInvalidated: options.includeInvalidated,
            validAt: options.validAt.toISOString(),
            startTime: options.startTime?.toISOString() || null,
            endTime: options.endTime.toISOString(),
          }),
          source: source ?? "search_api",
          responseTimeMs: responseTime,
          userId,
        },
      });

      logger.debug(
        `Logged recall event for user ${userId}: ${results.length} results in ${responseTime}ms`,
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

    // Add facts section
    if (facts.length > 0) {
      sections.push("## Key Facts\n");

      facts.forEach((fact) => {
        const validDate = fact.validAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const invalidInfo = fact.invalidAt
          ? ` → Invalidated ${fact.invalidAt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
          : "";

        sections.push(`- ${fact.fact}`);
        sections.push(`  *Valid from ${validDate}${invalidInfo}*`);
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
    }> = [];

    // Add non-session episodes first
    for (const episode of nonSessionEpisodes) {
      result.push({
        content: episode.originalContent,
        createdAt: episode.createdAt,
        spaceIds: episode.spaceIds || [],
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
          });
        }
      }
    }

    return result;
  }

  /**
   * Extract episodes with provenance tracking from all search sources
   * Deduplicates episodes and tracks which statements came from which source
   */
  private async extractEpisodesWithProvenance(sources: {
    episodeGraph: EpisodeGraphResult[];
    bfs: StatementNode[];
    vector: StatementNode[];
    bm25: StatementNode[];
  }): Promise<EpisodeWithProvenance[]> {
    const episodeMap = new Map<string, EpisodeWithProvenance>();

    // Process Episode Graph results (already episode-grouped)
    sources.episodeGraph.forEach((result) => {
      const episodeId = result.episode.uuid;

      if (!episodeMap.has(episodeId)) {
        episodeMap.set(episodeId, {
          episode: result.episode,
          statements: [],
          episodeGraphScore: result.score,
          bfsScore: 0,
          vectorScore: 0,
          bm25Score: 0,
          sourceBreakdown: { fromEpisodeGraph: 0, fromBFS: 0, fromVector: 0, fromBM25: 0 },
        });
      }

      const ep = episodeMap.get(episodeId)!;
      result.statements.forEach((statement) => {
        ep.statements.push({
          statement,
          sources: {
            episodeGraph: {
              score: result.score,
              entityMatches: result.metrics.entityMatchCount,
            },
          },
          primarySource: 'episodeGraph',
        });
        ep.sourceBreakdown.fromEpisodeGraph++;
      });
    });

    // Process BFS statements (need to group by episode)
    const bfsStatementsByEpisode = await groupStatementsByEpisode(sources.bfs);
    const bfsEpisodeIds = Array.from(bfsStatementsByEpisode.keys());
    const bfsEpisodes = await getEpisodesByUuids(bfsEpisodeIds);

    bfsStatementsByEpisode.forEach((statements, episodeId) => {
      if (!episodeMap.has(episodeId)) {
        const episode = bfsEpisodes.get(episodeId);
        if (!episode) return;

        episodeMap.set(episodeId, {
          episode,
          statements: [],
          episodeGraphScore: 0,
          bfsScore: 0,
          vectorScore: 0,
          bm25Score: 0,
          sourceBreakdown: { fromEpisodeGraph: 0, fromBFS: 0, fromVector: 0, fromBM25: 0 },
        });
      }

      const ep = episodeMap.get(episodeId)!;
      statements.forEach((statement) => {
        const hopDistance = (statement as any).bfsHopDistance || 4;
        const bfsRelevance = (statement as any).bfsRelevance || 0;

        // Check if this statement already exists (from episode graph)
        const existing = ep.statements.find((s) => s.statement.uuid === statement.uuid);
        if (existing) {
          // Add BFS source to existing statement
          existing.sources.bfs = { score: bfsRelevance, hopDistance, relevance: bfsRelevance };
        } else {
          // New statement from BFS
          ep.statements.push({
            statement,
            sources: { bfs: { score: bfsRelevance, hopDistance, relevance: bfsRelevance } },
            primarySource: 'bfs',
          });
          ep.sourceBreakdown.fromBFS++;
        }

        // Aggregate BFS score for episode with hop multiplier
        const hopMultiplier =
          hopDistance === 1 ? 2.0 : hopDistance === 2 ? 1.3 : hopDistance === 3 ? 1.0 : 0.8;
        ep.bfsScore += bfsRelevance * hopMultiplier;
      });

      // Average BFS score
      if (statements.length > 0) {
        ep.bfsScore /= statements.length;
      }
    });

    // Process Vector statements
    const vectorStatementsByEpisode = await groupStatementsByEpisode(sources.vector);
    const vectorEpisodeIds = Array.from(vectorStatementsByEpisode.keys());
    const vectorEpisodes = await getEpisodesByUuids(vectorEpisodeIds);

    vectorStatementsByEpisode.forEach((statements, episodeId) => {
      if (!episodeMap.has(episodeId)) {
        const episode = vectorEpisodes.get(episodeId);
        if (!episode) return;

        episodeMap.set(episodeId, {
          episode,
          statements: [],
          episodeGraphScore: 0,
          bfsScore: 0,
          vectorScore: 0,
          bm25Score: 0,
          sourceBreakdown: { fromEpisodeGraph: 0, fromBFS: 0, fromVector: 0, fromBM25: 0 },
        });
      }

      const ep = episodeMap.get(episodeId)!;
      statements.forEach((statement) => {
        const vectorScore = (statement as any).vectorScore || (statement as any).similarity || 0;

        const existing = ep.statements.find((s) => s.statement.uuid === statement.uuid);
        if (existing) {
          existing.sources.vector = { score: vectorScore, similarity: vectorScore };
        } else {
          ep.statements.push({
            statement,
            sources: { vector: { score: vectorScore, similarity: vectorScore } },
            primarySource: 'vector',
          });
          ep.sourceBreakdown.fromVector++;
        }

        ep.vectorScore += vectorScore;
      });

      if (statements.length > 0) {
        ep.vectorScore /= statements.length;
      }
    });

    // Process BM25 statements
    const bm25StatementsByEpisode = await groupStatementsByEpisode(sources.bm25);
    const bm25EpisodeIds = Array.from(bm25StatementsByEpisode.keys());
    const bm25Episodes = await getEpisodesByUuids(bm25EpisodeIds);

    bm25StatementsByEpisode.forEach((statements, episodeId) => {
      if (!episodeMap.has(episodeId)) {
        const episode = bm25Episodes.get(episodeId);
        if (!episode) return;

        episodeMap.set(episodeId, {
          episode,
          statements: [],
          episodeGraphScore: 0,
          bfsScore: 0,
          vectorScore: 0,
          bm25Score: 0,
          sourceBreakdown: { fromEpisodeGraph: 0, fromBFS: 0, fromVector: 0, fromBM25: 0 },
        });
      }

      const ep = episodeMap.get(episodeId)!;
      statements.forEach((statement) => {
        const bm25Score = (statement as any).bm25Score || (statement as any).score || 0;

        const existing = ep.statements.find((s) => s.statement.uuid === statement.uuid);
        if (existing) {
          existing.sources.bm25 = { score: bm25Score, rank: statements.indexOf(statement) };
        } else {
          ep.statements.push({
            statement,
            sources: { bm25: { score: bm25Score, rank: statements.indexOf(statement) } },
            primarySource: 'bm25',
          });
          ep.sourceBreakdown.fromBM25++;
        }

        ep.bm25Score += bm25Score;
      });

      if (statements.length > 0) {
        ep.bm25Score /= statements.length;
      }
    });

    return Array.from(episodeMap.values());
  }

  /**
   * Rate episodes by source hierarchy: Episode Graph > BFS > Vector > BM25
   */
  private rateEpisodesBySource(episodes: EpisodeWithProvenance[]): EpisodeWithProvenance[] {
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
    ratedEpisodes: EpisodeWithProvenance[],
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
  private calculateConfidence(filteredEpisodes: EpisodeWithProvenance[]): number {
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
    episodes: EpisodeWithProvenance[],
    maxEpisodes: number = 20,
  ): Promise<EpisodeWithProvenance[]> {
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
 * Quality filtering result
 */
interface QualityFilterResult {
  episodes: EpisodeWithProvenance[];
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
