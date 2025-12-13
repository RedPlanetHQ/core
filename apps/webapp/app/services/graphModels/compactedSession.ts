import {
  type CompactedSessionNode,
  type EpisodicNode,
} from "@core/types";
import { ProviderFactory } from "@core/providers";

// Get the graph provider instance
const graphProvider = () => ProviderFactory.getGraphProvider();

/**
 * Save or update a compacted session
 */
export async function saveCompactedSession(
  compact: CompactedSessionNode,
): Promise<string> {
  return graphProvider().saveCompactedSession(compact);
}

/**
 * Get a compacted session by UUID
 */
export async function getCompactedSession(
  uuid: string,
  userId: string,
): Promise<CompactedSessionNode | null> {
  return graphProvider().getCompactedSession(uuid, userId);
}

/**
 * Get compacted session by sessionId
 */
export async function getCompactedSessionBySessionId(
  sessionId: string,
  userId: string,
): Promise<CompactedSessionNode | null> {
  return graphProvider().getCompactedSessionBySessionId(sessionId, userId);
}

/**
 * Get all episodes linked to a compacted session
 */
export async function getCompactedSessionEpisodes(
  compactUuid: string,
  userId: string,
): Promise<string[]> {
  const episodes = await graphProvider().getEpisodesForCompact(compactUuid, userId);
  return episodes.map(e => e.uuid);
}

/**
 * Link episodes to compacted session
 */
export async function linkEpisodesToCompact(
  compactUuid: string,
  episodeUuids: string[],
  userId: string,
): Promise<void> {
  return graphProvider().linkEpisodesToCompact(compactUuid, episodeUuids, userId);
}

/**
 * Delete a compacted session
 */
export async function deleteCompactedSession(uuid: string, userId: string): Promise<void> {
  return graphProvider().deleteCompactedSession(uuid, userId);
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
  const stats = await graphProvider().getCompactionStats(userId);

  return {
    totalCompacts: stats.totalSessions,
    totalEpisodes: stats.totalEpisodes,
    averageCompressionRatio: stats.averageCompressionRatio,
    mostRecentCompaction: null, // Provider doesn't return this yet
  };
}

/**
 * Get all episodes for a session
 */
export async function getSessionEpisodes(
  sessionId: string,
  userId: string,
  afterTime?: Date,
): Promise<EpisodicNode[]> {
  return graphProvider().getSessionEpisodes(sessionId, userId, afterTime);
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
