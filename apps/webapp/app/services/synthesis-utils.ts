import { runQuery } from "~/lib/neo4j.server";
import { logger } from "~/services/logger.service";

/**
 * Find similar episodes to the given new episodes using semantic search
 * Returns historical episodes that are semantically similar for context
 */
export async function findSimilarEpisodes(
  newEpisodeIds: string[],
  userId: string,
  limit: number = 20,
): Promise<Array<{
  uuid: string;
  content: string;
  originalContent?: string;
  source?: string;
  createdAt: Date;
  validAt: Date;
  metadata?: any;
  sessionId?: string;
  similarity: number;
}>> {
  try {
    // Get embeddings for the new episodes
    const newEpisodesQuery = `
      MATCH (e:Episode {userId: $userId})
      WHERE e.uuid IN $newEpisodeIds AND e.embedding IS NOT NULL
      RETURN e.uuid as uuid, e.embedding as embedding
    `;

    const newEpisodes = await runQuery(newEpisodesQuery, { userId, newEpisodeIds });

    if (newEpisodes.length === 0) {
      logger.info("No new episodes with embeddings found");
      return [];
    }

    // Get the average embedding of new episodes for similarity search
    const embeddings = newEpisodes.map(r => r.get("embedding"));

    // Use the first embedding for now (could average multiple later)
    const searchEmbedding = embeddings[0];

    // Find similar historical episodes (excluding the new ones)
    const similarQuery = `
      MATCH (e:Episode {userId: $userId})
      WHERE e.embedding IS NOT NULL
        AND NOT e.uuid IN $newEpisodeIds
      WITH e, gds.similarity.cosine(e.embedding, $searchEmbedding) AS similarity
      WHERE similarity > 0.7
      RETURN e, similarity
      ORDER BY similarity DESC
      LIMIT $limit
    `;

    const result = await runQuery(similarQuery, {
      userId,
      newEpisodeIds,
      searchEmbedding,
      limit,
    });

    return result.map((record) => {
      const episode = record.get("e").properties;
      const similarity = record.get("similarity");

      return {
        uuid: episode.uuid,
        content: episode.content,
        originalContent: episode.originalContent,
        source: episode.source,
        createdAt: new Date(episode.createdAt),
        validAt: new Date(episode.validAt),
        metadata: episode.metadata ? JSON.parse(episode.metadata) : undefined,
        sessionId: episode.sessionId,
        similarity: Number(similarity),
      };
    });
  } catch (error) {
    logger.error("Error finding similar episodes:", {error});
    return [];
  }
}

/**
 * Calculate drift between current and previous persona
 * Returns a drift score (0-1) indicating how much the persona has changed
 */
export async function calculatePersonaDrift(
  currentSummary: string,
  previousSummary: string,
): Promise<number> {
  // TODO: Implement drift calculation
  // Could use:
  // - Lexical similarity (jaccard, cosine)
  // - Semantic similarity (embedding comparison)
  // - Structural similarity (section-by-section comparison)

  // For now, return 0 (no drift)
  return 0;
}
