/**
 * Compacted Session domain methods for Neo4j graph operations
 * Extracted from neo4j.ts and refactored to use dependency injection
 */

import type { CompactedSessionNode, EpisodicNode } from "@core/types";
import { parseCompactedSessionNode, parseEpisodicNode } from "../parsers";
import type { Neo4jCore } from "../core";
import { COMPACTED_SESSION_NODE_PROPERTIES, EPISODIC_NODE_PROPERTIES } from "../types";

export function createCompactedSessionMethods(core: Neo4jCore) {
  return {
    async saveCompactedSession(compact: CompactedSessionNode): Promise<string> {
      const query = `
        MERGE (cs:CompactedSession {uuid: $uuid})
        ON CREATE SET
          cs.sessionId = $sessionId,
          cs.summary = $summary,
          cs.summaryEmbedding = $summaryEmbedding,
          cs.episodeCount = $episodeCount,
          cs.startTime = $startTime,
          cs.endTime = $endTime,
          cs.createdAt = $createdAt,
          cs.confidence = $confidence,
          cs.userId = $userId,
          cs.workspaceId = $workspaceId,
          cs.source = $source,
          cs.compressionRatio = $compressionRatio,
          cs.metadata = $metadata
        ON MATCH SET
          cs.summary = $summary,
          cs.summaryEmbedding = $summaryEmbedding,
          cs.episodeCount = $episodeCount,
          cs.endTime = $endTime,
          cs.updatedAt = $updatedAt,
          cs.confidence = $confidence,
          cs.compressionRatio = $compressionRatio,
          cs.metadata = $metadata
        RETURN cs.uuid as uuid
      `;

      const params = {
        uuid: compact.uuid,
        sessionId: compact.sessionId,
        summary: compact.summary,
        summaryEmbedding: compact.summaryEmbedding,
        episodeCount: compact.episodeCount,
        startTime: compact.startTime.toISOString(),
        endTime: compact.endTime.toISOString(),
        createdAt: compact.createdAt.toISOString(),
        updatedAt: compact.updatedAt?.toISOString() || null,
        confidence: compact.confidence,
        userId: compact.userId,
        workspaceId: compact.workspaceId || null,
        source: compact.source,
        compressionRatio: compact.compressionRatio,
        metadata: JSON.stringify(compact.metadata || {}),
      };

      const result = await core.runQuery(query, params);
      return result[0].get("uuid");
    },

    async getCompactedSession(
      uuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<CompactedSessionNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {uuid: $uuid, userId: $userId${wsFilter}})
        RETURN cs
      `;

      const result = await core.runQuery(query, {
        uuid,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      if (result.length === 0) return null;

      const compact = result[0].get("cs").properties;
      return parseCompactedSessionNode(compact);
    },

    async getCompactedSessionBySessionId(
      sessionId: string,
      userId: string,
      workspaceId?: string
    ): Promise<CompactedSessionNode | null> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {sessionId: $sessionId, userId: $userId${wsFilter}})
        RETURN ${COMPACTED_SESSION_NODE_PROPERTIES} as compact
        ORDER BY cs.endTime DESC
        LIMIT 1
      `;

      const result = await core.runQuery(query, {
        sessionId,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      if (result.length === 0) return null;

      const compact = result[0].get("compact");
      return parseCompactedSessionNode(compact);
    },

    async deleteCompactedSession(
      uuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<void> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {uuid: $uuid, userId: $userId${wsFilter}})
        DETACH DELETE cs
      `;

      await core.runQuery(query, {
        uuid,
        userId,
        ...(workspaceId && { workspaceId }),
      });
    },

    async getCompactionStats(
      userId: string,
      workspaceId?: string
    ): Promise<{
      totalSessions: number;
      totalEpisodes: number;
      averageCompressionRatio: number;
    }> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {userId: $userId${wsFilter}})
        RETURN
          count(cs) as totalCompacts,
          sum(cs.episodeCount) as totalEpisodes,
          avg(cs.compressionRatio) as avgCompressionRatio
      `;

      const result = await core.runQuery(query, {
        userId,
        ...(workspaceId && { workspaceId }),
      });
      if (result.length === 0) {
        return {
          totalSessions: 0,
          totalEpisodes: 0,
          averageCompressionRatio: 0,
        };
      }

      const stats = result[0];
      return {
        totalSessions: stats.get("totalCompacts")?.toNumber?.() || Number(stats.get("totalCompacts")) || 0,
        totalEpisodes: stats.get("totalEpisodes")?.toNumber?.() || Number(stats.get("totalEpisodes")) || 0,
        averageCompressionRatio: stats.get("avgCompressionRatio") || 0,
      };
    },

    async linkEpisodesToCompact(
      compactUuid: string,
      episodeUuids: string[],
      userId: string,
      workspaceId?: string
    ): Promise<void> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {uuid: $compactUuid, userId: $userId${wsFilter}})
        UNWIND $episodeUuids as episodeUuid
        MATCH (e:Episode {uuid: episodeUuid, userId: $userId${wsFilter}})
        MERGE (cs)-[:COMPACTS {createdAt: datetime()}]->(e)
        MERGE (e)-[:COMPACTED_INTO {createdAt: datetime()}]->(cs)
      `;

      await core.runQuery(query, {
        compactUuid,
        episodeUuids,
        userId,
        ...(workspaceId && { workspaceId }),
      });
    },

    async getEpisodesForCompact(
      compactUuid: string,
      userId: string,
      workspaceId?: string
    ): Promise<EpisodicNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (cs:CompactedSession {uuid: $compactUuid, userId: $userId${wsFilter}})-[:COMPACTS]->(e:Episode)
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.createdAt ASC
      `;

      const result = await core.runQuery(query, {
        compactUuid,
        userId,
        ...(workspaceId && { workspaceId }),
      });
      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },

    async getSessionEpisodes(
      sessionId: string,
      userId: string,
      afterTime?: Date,
      workspaceId?: string,
    ): Promise<EpisodicNode[]> {
      const wsFilter = workspaceId ? ", workspaceId: $workspaceId" : "";

      const query = `
        MATCH (e:Episode {sessionId: $sessionId, userId: $userId${wsFilter}})
        ${afterTime ? "WHERE e.createdAt > $afterTime" : ""}
        RETURN ${EPISODIC_NODE_PROPERTIES} as episode
        ORDER BY e.createdAt ASC
      `;

      const result = await core.runQuery(query, {
        sessionId,
        userId,
        afterTime: afterTime?.toISOString(),
        ...(workspaceId && { workspaceId }),
      });

      return result.map((record) => parseEpisodicNode(record.get("episode")));
    },
  };
}
