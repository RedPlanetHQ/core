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
  workspaceId?: string,
): Promise<CompactedSessionNode | null> {
  return graphProvider().getCompactedSession(uuid, userId, workspaceId);
}

/**
 * Get compacted session by sessionId
 */
export async function getCompactedSessionBySessionId(
  sessionId: string,
  userId: string,
  workspaceId?: string,
): Promise<CompactedSessionNode | null> {
  return graphProvider().getCompactedSessionBySessionId(sessionId, userId, workspaceId);
}

/**
 * Get all episodes linked to a compacted session
 */
export async function getCompactedSessionEpisodes(
  compactUuid: string,
  userId: string,
  workspaceId?: string,
): Promise<string[]> {
  const episodes = await graphProvider().getEpisodesForCompact(compactUuid, userId, workspaceId);
  return episodes.map(e => e.uuid);
}

/**
 * Link episodes to compacted session
 */
export async function linkEpisodesToCompact(
  compactUuid: string,
  episodeUuids: string[],
  userId: string,
  workspaceId?: string,
): Promise<void> {
  return graphProvider().linkEpisodesToCompact(compactUuid, episodeUuids, userId, workspaceId);
}

/**
 * Delete a compacted session
 */
export async function deleteCompactedSession(uuid: string, userId: string, workspaceId?: string): Promise<void> {
  return graphProvider().deleteCompactedSession(uuid, userId, workspaceId);
}

/**
 * Get compaction statistics for a user
 */
export async function getCompactionStats(userId: string, workspaceId?: string): Promise<{
  totalCompacts: number;
  totalEpisodes: number;
  averageCompressionRatio: number;
  mostRecentCompaction: Date | null;
}> {
  const stats = await graphProvider().getCompactionStats(userId, workspaceId);

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
  workspaceId?: string,
): Promise<EpisodicNode[]> {
  return graphProvider().getSessionEpisodes(sessionId, userId, afterTime, workspaceId);
}

/**
 * Get episode count for a session
 */
export async function getSessionEpisodeCount(
  sessionId: string,
  userId: string,
  afterTime?: Date,
  workspaceId?: string,
): Promise<number> {
  const episodes = await getSessionEpisodes(sessionId, userId, afterTime, workspaceId);
  return episodes.length;
}
