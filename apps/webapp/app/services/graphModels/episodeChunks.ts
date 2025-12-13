import { ProviderFactory } from "@core/providers";
import { type EpisodicNode, type AdjacentChunks } from "@core/types";
import { logger } from "../logger.service";

// Get the graph provider instance
const graphProvider = () => ProviderFactory.getGraphProvider();

/**
 * Get an episode with its adjacent chunks for context
 * Returns matched episode plus ±N surrounding chunks from the same session
 */
export async function getEpisodeWithAdjacentChunks(
  episodeUuid: string,
  userId: string,
  contextWindow: number = 1,
): Promise<AdjacentChunks> {
  return graphProvider().getEpisodeWithAdjacentChunks(episodeUuid, userId, contextWindow);
}

/**
 * Get all episodes in a session, ordered by chunkIndex
 */
export async function getAllSessionChunks(
  sessionId: string,
  userId: string,
): Promise<EpisodicNode[]> {
  return graphProvider().getAllSessionChunks(sessionId, userId);
}

/**
 * Get session metadata from first episode (chunkIndex=0)
 */
export async function getSessionMetadata(
  sessionId: string,
  userId: string,
): Promise<EpisodicNode | null> {
  return graphProvider().getSessionMetadata(sessionId, userId);
}

/**
 * Delete all episodes in a session
 * Handles related statements and entities (orphan cleanup)
 */
export async function deleteSession(
  sessionId: string,
  userId: string,
): Promise<{
  deleted: boolean;
  episodesDeleted: number;
  statementsDeleted: number;
  entitiesDeleted: number;
}> {
  return graphProvider().deleteSession(sessionId, userId);
}

/**
 * Reconstruct content from chunks
 */
export function reconstructContentFromChunks(chunks: EpisodicNode[]): string {
  return chunks
    .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0))
    .map((chunk) => chunk.content)
    .join("\n\n");
}

/**
 * Format chunks with context for display
 */
export function formatChunksWithContext(chunks: EpisodicNode[]): string {
  const sorted = chunks.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));

  return sorted
    .map((chunk, idx) => {
      const header = chunk.chunkIndex !== undefined
        ? `## Section ${chunk.chunkIndex + 1}`
        : `## Part ${idx + 1}`;

      return `${header}\n\n${chunk.content}`;
    })
    .join("\n\n");
}
