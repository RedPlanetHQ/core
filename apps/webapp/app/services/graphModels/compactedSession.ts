import { runQuery } from "~/lib/neo4j.server";

export interface SessionEpisodeData {
  uuid: string;
  content: string;
  originalContent: string;
  source: string;
  createdAt: Date;
  validAt: Date;
  metadata: any;
  sessionId: string;
}

export interface CompactedSessionNode {
  uuid: string;
  sessionId: string;
  summary: string;
  summaryEmbedding: number[];
  episodeCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt?: Date;
  confidence: number;
  userId: string;
  source: string;
  compressionRatio: number;
  metadata: Record<string, any>;
}

/**
 * Save or update a compacted session
 */
export async function saveCompactedSession(
  compact: CompactedSessionNode,
): Promise<string> {
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
    source: compact.source,
    compressionRatio: compact.compressionRatio,
    metadata: JSON.stringify(compact.metadata || {}),
  };

  const result = await runQuery(query, params);
  return result[0].get("uuid");
}

/**
 * Get a compacted session by UUID
 */
export async function getCompactedSession(
  uuid: string,
): Promise<CompactedSessionNode | null> {
  const query = `
    MATCH (cs:CompactedSession {uuid: $uuid})
    RETURN cs
  `;

  const result = await runQuery(query, { uuid });
  if (result.length === 0) return null;

  const compact = result[0].get("cs").properties;
  return parseCompactedSessionNode(compact);
}

/**
 * Get compacted session by sessionId
 */
export async function getCompactedSessionBySessionId(
  sessionId: string,
  userId: string,
): Promise<CompactedSessionNode | null> {
  const query = `
    MATCH (cs:CompactedSession {sessionId: $sessionId, userId: $userId})
    RETURN cs
    ORDER BY cs.endTime DESC
    LIMIT 1
  `;

  const result = await runQuery(query, { sessionId, userId });
  if (result.length === 0) return null;

  const compact = result[0].get("cs").properties;
  return parseCompactedSessionNode(compact);
}

/**
 * Get all episodes linked to a compacted session
 */
export async function getCompactedSessionEpisodes(
  compactUuid: string,
): Promise<string[]> {
  const query = `
    MATCH (cs:CompactedSession {uuid: $compactUuid})-[:COMPACTS]->(e:Episode)
    RETURN e.uuid as episodeUuid
    ORDER BY e.createdAt ASC
  `;

  const result = await runQuery(query, { compactUuid });
  return result.map((r) => r.get("episodeUuid"));
}

/**
 * Link episodes to compacted session
 */
export async function linkEpisodesToCompact(
  compactUuid: string,
  episodeUuids: string[],
  userId: string,
): Promise<void> {
  const query = `
    MATCH (cs:CompactedSession {uuid: $compactUuid, userId: $userId})
    UNWIND $episodeUuids as episodeUuid
    MATCH (e:Episode {uuid: episodeUuid, userId: $userId})
    MERGE (cs)-[:COMPACTS {createdAt: datetime()}]->(e)
    MERGE (e)-[:COMPACTED_INTO {createdAt: datetime()}]->(cs)
  `;

  await runQuery(query, { compactUuid, episodeUuids, userId });
}

/**
 * Search compacted sessions by embedding similarity
 */
export async function searchCompactedSessionsByEmbedding(
  embedding: number[],
  userId: string,
  limit: number = 10,
  minScore: number = 0.7,
): Promise<Array<{ compact: CompactedSessionNode; score: number }>> {
  const query = `
    MATCH (cs:CompactedSession {userId: $userId})
    WHERE cs.summaryEmbedding IS NOT NULL
    WITH cs,
         gds.similarity.cosine(cs.summaryEmbedding, $embedding) AS score
    WHERE score >= $minScore
    RETURN cs, score
    ORDER BY score DESC
    LIMIT $limit
  `;

  const result = await runQuery(query, {
    embedding,
    userId,
    limit,
    minScore,
  });

  return result.map((r) => ({
    compact: parseCompactedSessionNode(r.get("cs").properties),
    score: r.get("score"),
  }));
}

/**
 * Get compacted sessions for a user
 */
export async function getUserCompactedSessions(
  userId: string,
  limit: number = 50,
): Promise<CompactedSessionNode[]> {
  const query = `
    MATCH (cs:CompactedSession {userId: $userId})
    RETURN cs
    ORDER BY cs.endTime DESC
    LIMIT $limit
  `;

  const result = await runQuery(query, { userId, limit });
  return result.map((r) => parseCompactedSessionNode(r.get("cs").properties));
}

/**
 * Delete a compacted session
 */
export async function deleteCompactedSession(uuid: string): Promise<void> {
  const query = `
    MATCH (cs:CompactedSession {uuid: $uuid})
    DETACH DELETE cs
  `;

  await runQuery(query, { uuid });
}

/**
 * Get compaction statistics for a user
 */
export async function getCompactionStats(userId: string): Promise<{
  totalCompacts: number;
  totalEpisodes: number;
  averageCompressionRatio: number;
  mostRecentCompaction: Date | null;
}> {
  const query = `
    MATCH (cs:CompactedSession {userId: $userId})
    RETURN
      count(cs) as totalCompacts,
      sum(cs.episodeCount) as totalEpisodes,
      avg(cs.compressionRatio) as avgCompressionRatio,
      max(cs.endTime) as mostRecent
  `;

  const result = await runQuery(query, { userId });
  if (result.length === 0) {
    return {
      totalCompacts: 0,
      totalEpisodes: 0,
      averageCompressionRatio: 0,
      mostRecentCompaction: null,
    };
  }

  const stats = result[0];
  return {
    totalCompacts: stats.get("totalCompacts")?.toNumber() || 0,
    totalEpisodes: stats.get("totalEpisodes")?.toNumber() || 0,
    averageCompressionRatio: stats.get("avgCompressionRatio") || 0,
    mostRecentCompaction: stats.get("mostRecent")
      ? new Date(stats.get("mostRecent"))
      : null,
  };
}

/**
 * Get all episodes for a session
 */
export async function getSessionEpisodes(
  sessionId: string,
  userId: string,
  afterTime?: Date,
): Promise<SessionEpisodeData[]> {
  const query = `
    MATCH (e:Episode {sessionId: $sessionId, userId: $userId})
    ${afterTime ? "WHERE e.createdAt > $afterTime" : ""}
    RETURN e
    ORDER BY e.createdAt ASC
  `;

  const result = await runQuery(query, {
    sessionId,
    userId,
    afterTime: afterTime?.toISOString(),
  });

  return result.map((r) => r.get("e").properties);
}

/**
 * Get episode count for a session
 */
export async function getSessionEpisodeCount(
  sessionId: string,
  userId: string,
  afterTime?: Date,
): Promise<number> {
  const episodes = await getSessionEpisodes(sessionId, userId, afterTime);
  return episodes.length;
}

/**
 * Helper to parse raw compact node from Neo4j
 */
function parseCompactedSessionNode(raw: any): CompactedSessionNode {
  return {
    uuid: raw.uuid,
    sessionId: raw.sessionId,
    summary: raw.summary,
    summaryEmbedding: raw.summaryEmbedding || [],
    episodeCount: raw.episodeCount || 0,
    startTime: new Date(raw.startTime),
    endTime: new Date(raw.endTime),
    createdAt: new Date(raw.createdAt),
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : undefined,
    confidence: raw.confidence || 0,
    userId: raw.userId,
    source: raw.source,
    compressionRatio: raw.compressionRatio || 1,
    metadata:
      typeof raw.metadata === "string"
        ? JSON.parse(raw.metadata)
        : raw.metadata || {},
  };
}
