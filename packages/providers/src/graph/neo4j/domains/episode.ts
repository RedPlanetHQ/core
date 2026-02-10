/**
 * Episode domain methods for Neo4j graph operations
 * Extracted from neo4j.ts and refactored to use dependency injection
 */

import type { EpisodicNode, AdjacentChunks, StatementNode } from "@core/types";
import { parseEpisodicNode, parseStatementNode } from "../parsers";
import type { Neo4jCore } from "../core";
import { EPISODIC_NODE_PROPERTIES, STATEMENT_NODE_PROPERTIES } from "../types";

export function createEpisodeMethods(core: Neo4jCore) {
  return {
    async saveEpisode(episode: EpisodicNode): Promise<string> {
      const query = `
        MERGE (e:Episode {uuid: $uuid})
        ON CREATE SET
          e.content = $content,
          e.originalContent = $originalContent,
          e.contentEmbedding = $contentEmbedding,
          e.metadata = $metadata,
          e.source = $source,
          e.createdAt = $createdAt,
          e.validAt = $validAt,
          e.userId = $userId,
          e.workspaceId = $workspaceId,
          e.labelIds = $labelIds,
          e.sessionId = $sessionId,
          e.queueId = $queueId,
          e.type = $type,
          e.chunkIndex = $chunkIndex,
          e.totalChunks = $totalChunks,
          e.version = $version,
          e.contentHash = $contentHash,
          e.previousVersionSessionId = $previousVersionSessionId,
          e.chunkHashes = $chunkHashes
        ON MATCH SET
          e.content = $content,
          e.contentEmbedding = $contentEmbedding,
          e.originalContent = $originalContent,
          e.metadata = $metadata,
          e.source = $source,
          e.validAt = $validAt,
          e.workspaceId = $workspaceId,
          e.labelIds = $labelIds,
          e.sessionId = $sessionId,
          e.queueId = $queueId,
          e.type = $type,
          e.chunkIndex = $chunkIndex,
          e.totalChunks = $totalChunks,
          e.version = $version,
          e.contentHash = $contentHash,
          e.previousVersionSessionId = $previousVersionSessionId,
          e.chunkHashes = $chunkHashes
        RETURN e.uuid as uuid
      `;

      const params = {
        uuid: episode.uuid,
        content: episode.content,
        originalContent: episode.originalContent,
        source: episode.source,
        metadata: JSON.stringify(episode.metadata || {}),
        userId: episode.userId || null,
        workspaceId: episode.workspaceId || null,
        labelIds: episode.labelIds || [],
        createdAt: episode.createdAt.toISOString(),
        validAt: episode.validAt.toISOString(),
        contentEmbedding: episode.contentEmbedding || [],
        sessionId: episode.sessionId,
        queueId: episode.queueId || null,
        type: episode.type || null,
        chunkIndex: episode.chunkIndex !== undefined ? episode.chunkIndex : null,
        totalChunks: episode.totalChunks || null,
        version: episode.version || null,
        contentHash: episode.contentHash || null,
        previousVersionSessionId: episode.previousVersionSessionId || null,
        chunkHashes: episode.chunkHashes || [],
      };

      const result = await core.runQuery(query, params);
      return result[0].get("uuid");
    },

    async getEpisode(uuid: string, withEmbedding: boolean, userId?: string, workspaceId?: string): Promise<EpisodicNode | null> {
      const filters: string[] = ["uuid: $uuid"];
      if (userId) filters.push("userId: $userId");
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const matchFilter = `{${filters.join(", ")}${wsFilter}}`;

      const query = `
        MATCH (e:Episode ${matchFilter})
        RETURN ${withEmbedding ? `${EPISODIC_NODE_PROPERTIES}, e.contentEmbedding as contentEmbedding` : EPISODIC_NODE_PROPERTIES} as episode
      `;

      const result = await core.runQuery(query, {
        uuid,
        ...(userId && { userId }),
        ...(workspaceId && { workspaceId }),
      });
      if (result.length === 0) return null;

      return parseEpisodicNode(result[0].get("episode"));
    },

    async getEpisodes(uuids: string[], userId: string, withEmbedding: boolean, workspaceId?: string): Promise<EpisodicNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        UNWIND $uuids AS uuid
        MATCH (e:Episode {userId: $userId${wsFilter}, uuid: uuid})
        RETURN ${withEmbedding ? `${EPISODIC_NODE_PROPERTIES}, e.contentEmbedding as contentEmbedding` : EPISODIC_NODE_PROPERTIES} as episode
      `;

      const result = await core.runQuery(query, {
        uuids,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      if (result.length === 0) return [];

      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    async getEpisodesByUser(userId: string, orderBy?: string, limit?: number, descending?: boolean, workspaceId?: string): Promise<EpisodicNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.${orderBy || "createdAt"} ${descending ? "DESC" : "ASC"}
        LIMIT ${limit || 10}
      `;

      const result = await core.runQuery(query, {
        userId,
        ...(workspaceId && { workspaceId }),
      });
      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    async getEpisodeCountByUser(userId: string, createdAfter?: Date, workspaceId?: string): Promise<number> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = createdAfter ?
        `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.createdAt > $createdAfter
        RETURN count(e) as episodeCount
      `:
        `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        RETURN count(e) as episodeCount
      `;

      const result = await core.runQuery(query, {
        userId,
        createdAfter,
        ...(workspaceId && { workspaceId }),
      });
      return result[0].get("episodeCount").toNumber();
    },

    async getRecentEpisodes(params: {
      userId: string;
      limit: number;
      labelIds?: string[];
      sessionId?: string;
      source?: string;
      workspaceId?: string;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      let filters = [];
      if (params.source) filters.push(`e.source = $source`);
      if (params.sessionId) filters.push(`e.sessionId = $sessionId`);
      if (params.labelIds && params.labelIds.length > 0) {
        filters.push(`ANY(labelId IN $labelIds WHERE labelId IN e.labelIds)`);
      }

      const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE true ${whereClause}
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.validAt DESC
        LIMIT ${params.limit}
      `;

      const result = await core.runQuery(query, {
        userId: params.userId,
        source: params.source || null,
        sessionId: params.sessionId || null,
        labelIds: params.labelIds || [],
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    async getEpisodesBySession(
      sessionId: string,
      userId: string,
      workspaceId?: string
    ): Promise<EpisodicNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {userId: $userId, sessionId: $sessionId${wsFilter}})
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.chunkIndex ASC
      `;

      const result = await core.runQuery(query, {
        userId,
        sessionId,
        ...(workspaceId && { workspaceId }),
      });
      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    async deleteEpisodeWithRelatedNodes(
      uuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<{
      episodesDeleted: number;
      statementsDeleted: number;
      entitiesDeleted: number;
      deletedEpisodeUuids: string[];
      deletedStatementUuids: string[];
      deletedEntityUuids: string[];
    }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      // Check if episode exists
      const episodeCheck = await core.runQuery(
        `MATCH (e:Episode {uuid: $uuid, userId: $userId${wsFilter}}) RETURN e.uuid as uuid`,
        { uuid, userId, ...(workspaceId && { workspaceId }) }
      );

      if (!episodeCheck || episodeCheck.length === 0) {
        return {
          episodesDeleted: 0,
          statementsDeleted: 0,
          entitiesDeleted: 0,
          deletedEpisodeUuids: [],
          deletedStatementUuids: [],
          deletedEntityUuids: [],
        };
      }

      const query = `
        MATCH (episode:Episode {uuid: $uuid, userId: $userId${wsFilter}})

        // Get all related data first
        OPTIONAL MATCH (episode)-[:HAS_PROVENANCE]->(s:Statement)
        OPTIONAL MATCH (s)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)

        // Collect all related nodes
        WITH episode, collect(DISTINCT s) as statements, collect(DISTINCT entity) as entities

        // Find statements only connected to this episode
        UNWIND CASE WHEN size(statements) = 0 THEN [null] ELSE statements END as stmt
        OPTIONAL MATCH (otherEpisode:Episode)-[:HAS_PROVENANCE]->(stmt)
        WHERE stmt IS NOT NULL AND otherEpisode.uuid <> $uuid AND otherEpisode.userId = $userId

        WITH episode, statements, entities,
             collect(CASE WHEN stmt IS NOT NULL AND otherEpisode IS NULL THEN stmt ELSE null END) as orphanedStatements

        // Filter to valid orphaned statements and collect UUIDs
        WITH episode, statements, entities, [s IN orphanedStatements WHERE s IS NOT NULL] as stmtsToDelete
        WITH episode, stmtsToDelete, entities, [s IN stmtsToDelete | s.uuid] as statementUuids

        // Find orphaned entities (only connected to statements we're deleting)
        UNWIND CASE WHEN size(entities) = 0 THEN [null] ELSE entities END as entity
        OPTIONAL MATCH (entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(otherStmt:Statement)
        WHERE entity IS NOT NULL AND NOT otherStmt IN stmtsToDelete

        WITH episode, stmtsToDelete, statementUuids,
             collect(CASE WHEN entity IS NOT NULL AND otherStmt IS NULL THEN entity ELSE null END) as orphanedEntities

        // Filter to valid orphaned entities and collect UUIDs
        WITH episode, stmtsToDelete, statementUuids, [entity IN orphanedEntities WHERE entity IS NOT NULL] as entitiesToDelete
        WITH episode, stmtsToDelete, statementUuids, entitiesToDelete, [e IN entitiesToDelete | e.uuid] as entityUuids

        // Delete orphaned statements
        FOREACH (stmt IN stmtsToDelete | DETACH DELETE stmt)

        // Delete orphaned entities only
        FOREACH (entity IN entitiesToDelete | DETACH DELETE entity)

        // Store episode UUID before deletion
        WITH episode, stmtsToDelete, entitiesToDelete, statementUuids, entityUuids, episode.uuid as episodeUuid

        // Delete episode
        DETACH DELETE episode

        RETURN
          1 as episodesDeleted,
          size(stmtsToDelete) as statementsDeleted,
          size(entitiesToDelete) as entitiesDeleted,
          [episodeUuid] as deletedEpisodeUuids,
          statementUuids as deletedStatementUuids,
          entityUuids as deletedEntityUuids
      `;

      const result = await core.runQuery(query, { uuid, userId, ...(workspaceId && { workspaceId }) });

      if (result.length === 0) {
        return {
          episodesDeleted: 0,
          statementsDeleted: 0,
          entitiesDeleted: 0,
          deletedEpisodeUuids: [],
          deletedStatementUuids: [],
          deletedEntityUuids: [],
        };
      }

      const record = result[0];
      return {
        episodesDeleted: record.get("episodesDeleted") || 0,
        statementsDeleted: record.get("statementsDeleted") || 0,
        entitiesDeleted: record.get("entitiesDeleted") || 0,
        deletedEpisodeUuids: record.get("deletedEpisodeUuids") || [],
        deletedStatementUuids: record.get("deletedStatementUuids") || [],
        deletedEntityUuids: record.get("deletedEntityUuids") || [],
      };
    },

    async searchEpisodesByEmbedding(params: {
      queryEmbedding: number[];
      threshold: number;
      limit: number;
      userId: string;
      labelIds?: string[];
      spaceIds?: string[];
      workspaceId?: string;
    }): Promise<Array<{ episode: EpisodicNode; score: number }>> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      let additionalFilters = [];
      if (params.spaceIds && params.spaceIds.length > 0) {
        additionalFilters.push(`ANY(spaceId IN $spaceIds WHERE spaceId IN episode.spaceIds)`);
      }
      if (params.labelIds && params.labelIds.length > 0) {
        additionalFilters.push(`ANY(labelId IN $labelIds WHERE labelId IN episode.labelIds)`);
      }

      const extraWhere = additionalFilters.length > 0 ? `AND ${additionalFilters.join(" AND ")}` : "";

      const query = `
      MATCH (episode:Episode{userId: $userId${wsFilter}})
      WHERE episode.contentEmbedding IS NOT NULL and size(episode.contentEmbedding) > 0 ${extraWhere}
      WITH episode, gds.similarity.cosine(episode.contentEmbedding, $queryEmbedding) AS score
      WHERE score >= $threshold
      RETURN ${EPISODIC_NODE_PROPERTIES} as episode, score
      ORDER BY score DESC
      LIMIT ${params.limit}`;

      const result = await core.runQuery(query, {
        queryEmbedding: params.queryEmbedding,
        threshold: params.threshold,
        userId: params.userId,
        spaceIds: params.spaceIds || [],
        labelIds: params.labelIds || [],
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      if (!result || result.length === 0) {
        return [];
      }

      return result.map((record) => ({
        episode: parseEpisodicNode(record.get("episode")),
        score: record.get("score"),
      }));
    },

    async addLabelsToEpisodes(
      episodeUuids: string[],
      labelIds: string[],
      userId: string,
      workspaceId: string,
      forceUpdate: boolean = false
    ): Promise<number> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.uuid IN $episodeUuids
        SET e.labelIds = CASE
          WHEN e.labelIds IS NULL or $forceUpdate THEN $labelIds
          ELSE e.labelIds + [labelId IN $labelIds WHERE NOT labelId IN e.labelIds]
        END
        RETURN count(e) as updatedEpisodes
      `;

      const result = await core.runQuery(query, {
        episodeUuids,
        labelIds,
        userId,
        forceUpdate,
        ...(workspaceId && { workspaceId }),
      });
      return result[0].get("updatedEpisodes").toNumber();
    },

    async addLabelsToEpisodesBySessionId(
      sessionId: string,
      labelIds: string[],
      userId: string,
      workspaceId: string,
      forceUpdate: boolean = false
    ): Promise<number> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {userId: $userId, sessionId: $sessionId${wsFilter}})
        SET e.labelIds = CASE
          WHEN e.labelIds IS NULL or $forceUpdate THEN $labelIds
          ELSE e.labelIds + [labelId IN $labelIds WHERE NOT labelId IN e.labelIds]
        END
        RETURN count(e) as updatedEpisodes
      `;

      const result = await core.runQuery(query, {
        sessionId,
        labelIds,
        userId,
        forceUpdate,
        ...(workspaceId && { workspaceId }),
      });
      return result[0].get("updatedEpisodes").toNumber();
    },

    async getEpisodeWithAdjacentChunks(
      episodeUuid: string,
      userId: string,
      contextWindow: number = 1,
      workspaceId?: string
    ): Promise<AdjacentChunks> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      // First get the matched episode to find its sessionId and chunkIndex
      const matchedQuery = `
        MATCH (matched:Episode {uuid: $episodeUuid, userId: $userId${wsFilter}})
        RETURN ${EPISODIC_NODE_PROPERTIES.replace(/e\./g, "matched.")} as episode
      `;

      const matchedResult = await core.runQuery(matchedQuery, {
        episodeUuid,
        userId,
        ...(workspaceId && { workspaceId }),
      });

      if (matchedResult.length === 0) {
        throw new Error(`Episode not found: ${episodeUuid}`);
      }

      const matchedChunk = parseEpisodicNode(matchedResult[0].get("episode"));

      // If no sessionId or chunkIndex, return only matched chunk
      if (!matchedChunk.sessionId || matchedChunk.chunkIndex === undefined) {
        if (core.logger) {
          core.logger.info(
            `Episode has no sessionId or chunkIndex, returning without adjacent chunks: ${episodeUuid}`
          );
        }
        return {
          matchedChunk,
          previousChunk: undefined,
          nextChunk: undefined,
        };
      }

      // Get adjacent chunks based on context window
      const minIndex = Math.max(0, matchedChunk.chunkIndex - contextWindow);
      const maxIndex = matchedChunk.chunkIndex + contextWindow;

      const adjacentQuery = `
        MATCH (e:Episode {
          userId: $userId,
          sessionId: $sessionId${wsFilter}
        })
        WHERE e.chunkIndex >= $minIndex
          AND e.chunkIndex <= $maxIndex
          AND e.chunkIndex <> $matchedChunkIndex
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.chunkIndex ASC
      `;

      const adjacentResult = await core.runQuery(adjacentQuery, {
        userId,
        sessionId: matchedChunk.sessionId,
        minIndex,
        maxIndex,
        matchedChunkIndex: matchedChunk.chunkIndex,
        ...(workspaceId && { workspaceId }),
      });

      const adjacentChunks = adjacentResult.map((record) =>
        parseEpisodicNode(record.get("episode"))
      );

      // Find previous and next chunks
      const previousChunk = adjacentChunks.find(
        (chunk) => chunk.chunkIndex === matchedChunk.chunkIndex! - 1
      );

      const nextChunk = adjacentChunks.find(
        (chunk) => chunk.chunkIndex === matchedChunk.chunkIndex! + 1
      );

      return {
        matchedChunk,
        previousChunk,
        nextChunk,
      };
    },

    async getAllSessionChunks(sessionId: string, userId: string, workspaceId?: string): Promise<EpisodicNode[]> {
      return this.getEpisodesBySession(sessionId, userId, workspaceId);
    },

    async getSessionMetadata(
      sessionId: string,
      userId: string,
      workspaceId?: string
    ): Promise<EpisodicNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {sessionId: $sessionId, userId: $userId${wsFilter}})
        WHERE e.chunkIndex = 0
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        LIMIT 1
      `;

      const result = await core.runQuery(query, {
        sessionId,
        userId,
        ...(workspaceId && { workspaceId }),
      });

      if (result.length === 0) {
        return null;
      }

      return parseEpisodicNode(result[0].get("episode"));
    },

    async deleteSession(
      sessionId: string,
      userId: string,
      workspaceId?: string
    ): Promise<{
      deleted: boolean;
      episodesDeleted: number;
      statementsDeleted: number;
      entitiesDeleted: number;
    }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {sessionId: $sessionId, userId: $userId${wsFilter}})

        // Get all related data first
        OPTIONAL MATCH (e)-[:HAS_PROVENANCE]->(s:Statement)
        OPTIONAL MATCH (s)-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]->(entity:Entity)

        // Collect all related nodes
        WITH e, collect(DISTINCT s) as statements, collect(DISTINCT entity) as entities

        // Find orphaned entities (only connected to statements we're deleting)
        UNWIND CASE WHEN size(entities) = 0 THEN [null] ELSE entities END as entity
        OPTIONAL MATCH (entity)<-[:HAS_SUBJECT|HAS_PREDICATE|HAS_OBJECT]-(otherStmt:Statement)
        WHERE entity IS NOT NULL AND NOT otherStmt IN statements

        WITH e, statements,
             collect(CASE WHEN entity IS NOT NULL AND otherStmt IS NULL THEN entity ELSE null END) as orphanedEntities

        // Delete statements
        FOREACH (stmt IN statements | DETACH DELETE stmt)

        // Delete orphaned entities only
        With e, statements, [entity IN orphanedEntities WHERE entity IS NOT NULL] as validOrphanedEntities
        FOREACH (entity IN validOrphanedEntities | DETACH DELETE entity)

        // Delete episodes
        WITH collect(e) as episodes, statements, validOrphanedEntities
        FOREACH (episode IN episodes | DETACH DELETE episode)

        RETURN
          true as deleted,
          size(episodes) as episodesDeleted,
          size(statements) as statementsDeleted,
          size(validOrphanedEntities) as entitiesDeleted
      `;

      try {
        const result = await core.runQuery(query, {
          sessionId,
          userId,
          ...(workspaceId && { workspaceId }),
        });

        if (result.length === 0) {
          return {
            deleted: false,
            episodesDeleted: 0,
            statementsDeleted: 0,
            entitiesDeleted: 0,
          };
        }

        const record = result[0];
        return {
          deleted: record.get("deleted") || false,
          episodesDeleted: record.get("episodesDeleted") || 0,
          statementsDeleted: record.get("statementsDeleted") || 0,
          entitiesDeleted: record.get("entitiesDeleted") || 0,
        };
      } catch (error) {
        if (core.logger) {
          core.logger.error("Error deleting session:", { error });
        }
        throw error;
      }
    },

    /**
     * Get all sessions for a user (first episode of each session)
     *
     * Returns the first episode (chunkIndex=0) of each session for session-level metadata.
     *
     * @param params - Query parameters
     * @param params.userId - The user ID
     * @param params.type - Optional filter by episode type (CONVERSATION or DOCUMENT)
     * @param params.limit - Optional limit on number of sessions (default: 50)
     * @param params.workspaceId - Optional workspace ID for filtering
     * @returns Array of episode nodes (one per session)
     */
    async getUserSessions(params: {
      userId: string;
      type?: string;
      limit?: number;
      workspaceId?: string;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const limit = params.limit || 50;
      const typeFilter = params.type ? "AND e.type = $type" : "";
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.chunkIndex = 0 ${typeFilter}
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.createdAt DESC
        LIMIT ${limit}
      `;

      const result = await core.runQuery(query, {
        userId: params.userId,
        type: params.type,
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    /**
     * Get episodes by userId with optional time range filtering
     *
     * @param params - Query parameters
     * @param params.userId - The user ID
     * @param params.startTime - Optional start time for filtering
     * @param params.endTime - Optional end time for filtering
     * @param params.workspaceId - Optional workspace ID for filtering
     * @returns Array of episode nodes within the time range
     */
    async getEpisodesByUserId(params: {
      userId: string;
      startTime?: Date;
      endTime?: Date;
      workspaceId?: string;
    }): Promise<EpisodicNode[]> {
      const wsFilter = params.workspaceId ? ", workspaceId: $workspaceId" : "";
      const conditions: string[] = [];

      if (params.startTime) {
        conditions.push("e.createdAt >= datetime($startTime)");
      }
      if (params.endTime) {
        conditions.push("e.createdAt <= datetime($endTime)");
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        ${whereClause}
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.createdAt ASC
      `;

      const result = await core.runQuery(query, {
        userId: params.userId,
        startTime: params.startTime?.toISOString(),
        endTime: params.endTime?.toISOString(),
        ...(params.workspaceId && { workspaceId: params.workspaceId }),
      });

      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    /**
     * Link an episode to an existing statement (for duplicate handling)
     *
     * Creates a HAS_PROVENANCE relationship between episode and statement.
     * Used when consolidating duplicate statements.
     *
     * @param episodeUuid - The episode UUID
     * @param statementUuid - The statement UUID to link to
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID for filtering
     */
    async linkEpisodeToStatement(
      episodeUuid: string,
      statementUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<void> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId${wsFilter}})
        MATCH (statement:Statement {uuid: $statementUuid, userId: $userId${wsFilter}})
        MERGE (episode)-[r:HAS_PROVENANCE]->(statement)
        ON CREATE SET r.uuid = randomUUID(), r.createdAt = datetime(), r.userId = $userId, r.workspaceId = $workspaceId
      `;

      await core.runQuery(query, {
        episodeUuid,
        statementUuid,
        userId,
        workspaceId: workspaceId || null,
      });
    },

    /**
     * Move all provenance relationships from source statement to target statement
     *
     * Used when consolidating duplicate statements - moves ALL episode links,
     * not just one. Deletes old relationships and creates new ones to target.
     *
     * @param sourceStatementUuid - The source statement UUID
     * @param targetStatementUuid - The target statement UUID
     * @param userId - The user ID
     * @param workspaceId - Optional workspace ID for filtering
     * @returns Number of episode relationships moved
     */
    async moveProvenanceToStatement(
      sourceStatementUuid: string,
      targetStatementUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<number> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (source:Statement {uuid: $sourceStatementUuid, userId: $userId${wsFilter}})
        MATCH (target:Statement {uuid: $targetStatementUuid, userId: $userId${wsFilter}})

        // Find all episodes linked to source
        OPTIONAL MATCH (episode:Episode)-[r:HAS_PROVENANCE]->(source)
        WITH source, target, collect(episode) AS episodes, collect(r) AS rels

        // Delete old relationships
        FOREACH (r IN rels | DELETE r)

        // Create new relationships to target (MERGE to avoid duplicates)
        FOREACH (ep IN episodes | MERGE (ep)-[newR:HAS_PROVENANCE]->(target)
          ON CREATE SET newR.uuid = randomUUID(), newR.createdAt = datetime(), newR.userId = $userId, newR.workspaceId = $workspaceId)

        RETURN size(episodes) AS movedCount
      `;

      const result = await core.runQuery(query, {
        sourceStatementUuid,
        targetStatementUuid,
        userId,
        workspaceId: workspaceId || null,
      });

      const count = result[0]?.get("movedCount");
      return count ? Number(count) : 0;
    },

    async getStatementsInvalidatedByEpisode(
      episodeUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<StatementNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (episode:Episode {uuid: $episodeUuid, userId: $userId${wsFilter}})
        OPTIONAL MATCH (episode)-[:HAS_PROVENANCE]->(s:Statement)
        WHERE s.invalidatedBy IS NOT NULL
        RETURN ${STATEMENT_NODE_PROPERTIES} as statement
      `;

      const result = await core.runQuery(query, {
        episodeUuid,
        userId,
        ...(workspaceId && { workspaceId }),
      });

      return result.map((record) => parseStatementNode(record.get("statement")));
    },

    async invalidateStatementsFromPreviousVersion(
      sessionId: string,
      userId: string,
      workspaceId: string | undefined,
      previousVersion: number,
      invalidatedBy: string,
      invalidatedAt?: Date,
      changedChunkIndices?: number[]
    ): Promise<{ statementUuids: string[]; invalidatedCount: number }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const chunkFilter =
        changedChunkIndices && changedChunkIndices.length > 0
          ? `AND e.chunkIndex IN $changedChunkIndices`
          : "";

      const query = `
        MATCH (e:Episode {sessionId: $sessionId, userId: $userId${wsFilter}, version: $previousVersion})-[:HAS_PROVENANCE]->(s:Statement)
        WHERE s.invalidAt IS NULL ${chunkFilter}
        SET s.invalidAt = $invalidatedAt,
            s.invalidatedBy = $invalidatedBy
        RETURN collect(s.uuid) as statementUuids, count(s) as invalidatedCount
      `;

      // Only include changedChunkIndices in params if it's being used in the query
      const params: Record<string, any> = {
        sessionId,
        userId,
        previousVersion,
        invalidatedBy,
        invalidatedAt: invalidatedAt ? invalidatedAt.toISOString() : new Date().toISOString(),
        ...(workspaceId && { workspaceId }),
      };

      if (changedChunkIndices && changedChunkIndices.length > 0) {
        params.changedChunkIndices = changedChunkIndices;
      }

      const result = await core.runQuery(query, params);

      if (result.length === 0) {
        return {
          invalidatedCount: 0,
          statementUuids: [],
        };
      }
      const record = result[0];
      return {
        invalidatedCount: record.get("invalidatedCount") || 0,
        statementUuids: record.get("statementUuids") || [],
      };
    },

    async getLatestVersionFirstEpisode(
      sessionId: string,
      userId: string,
      workspaceId?: string
    ): Promise<EpisodicNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const query = `
        MATCH (e:Episode {sessionId: $sessionId, userId: $userId${wsFilter}})
        WHERE e.chunkIndex = 0
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.version DESC
        LIMIT 1
      `;

      const result = await core.runQuery(query, {
        sessionId,
        userId,
        ...(workspaceId && { workspaceId }),
      });

      if (result.length === 0) {
        return null;
      }

      const record = result[0];
      const episodeNode = record.get("episode");

      return episodeNode;
    },

    async updateEpisodeRecallCount(userId: string, episodeUuids: string[], workspaceId?: string) {
      const wsCondition = workspaceId ? " AND e.workspaceId = $workspaceId" : "";
      const cypher = `
        MATCH (e:Episode)
        WHERE e.uuid IN $episodeUuids and e.userId = $userId${wsCondition}
        SET e.recallCount = coalesce(e.recallCount, 0) + 1
      `;
      await core.runQuery(cypher, {
        episodeUuids,
        userId,
        ...(workspaceId && { workspaceId }),
      });
    },

    async episodeEntityMatchCount(episodeIds: string[], entityIds: string[], userId: string, workspaceId?: string): Promise<Map<string, number>> {
      const wsFilterEp = workspaceId ? ", workspaceId: $workspaceId" : "";
      const wsFilterEn = workspaceId ? ", workspaceId: $workspaceId" : "";
      const cypher = `
      // Use UNWIND for better query planning with large episode sets
      UNWIND $episodeIds AS episodeId
      MATCH (ep:Episode {userId: $userId${wsFilterEp}, uuid: episodeId})

      // Find statements with matching query entities (early filter on entityIds)
      OPTIONAL MATCH (ep)-[:HAS_PROVENANCE]->(s:Statement)-[:HAS_SUBJECT|HAS_OBJECT|HAS_PREDICATE]-(entity:Entity {userId: $userId${wsFilterEn}})
      WHERE entity.uuid IN $entityIds

      // Count distinct matching entities (OPTIONAL MATCH handles episodes with 0 matches)
      WITH episodeId, count(DISTINCT entity.uuid) as entityMatchCount
      WHERE entityMatchCount > 0
      RETURN episodeId, entityMatchCount
    `;
      const records = await core.runQuery(cypher, {
        episodeIds,
        entityIds,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      const matchCounts = new Map<string, number>();
      records.forEach((record) => {
        const episodeId = record.get("episodeId");
        const count =
          typeof record.get("entityMatchCount") === "bigint"
            ? Number(record.get("entityMatchCount"))
            : record.get("entityMatchCount");
        matchCounts.set(episodeId, count);
      });
      return matchCounts;
    },

    async getEpisodesInvalidFacts(episodeUuids: string[], userId: string, workspaceId?: string) {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";
      const cypher = `
        MATCH (e:Episode {userId: $userId${wsFilter}})
        WHERE e.uuid IN $episodeUuids
        MATCH (e)-[:HAS_PROVENANCE]->(s:Statement {userId: $userId${wsFilter}})
        WHERE s.invalidAt IS NOT NULL
        RETURN e.uuid as episodeUuid, s.uuid as statementUuid, s.fact as fact, s.validAt as validAt, s.invalidAt as invalidAt
      `;
      const records = await core.runQuery(cypher, {
        episodeUuids,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      return records.map((record) => ({
        episodeUuid: record.get("episodeUuid"),
        statementUuid: record.get("statementUuid"),
        fact: record.get("fact"),
        validAt: record.get("validAt"),
        invalidAt: record.get("invalidAt"),
      }));
    }
  };
}
