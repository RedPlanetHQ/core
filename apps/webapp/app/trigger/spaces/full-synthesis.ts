import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import { getSpace, getSpaceEpisodes } from "~/services/graphModels/space";
import { findSimilarEpisodes } from "~/services/synthesis-utils";
import { generatePersonaSummary } from "./synthesis/persona";
import { runQuery } from "~/lib/neo4j.server";
import { updateSpaceStatus, SPACE_STATUS } from "../utils/space-status";

interface FullSynthesisPayload {
  userId: string;
  workspaceId: string;
  spaceId: string;
  triggerSource?: "auto" | "manual";
}

type SynthesisMode = "full" | "incremental";

export const fullSynthesisQueue = queue({
  name: "full-synthesis-queue",
  concurrencyLimit: 1,
});

export const fullSynthesisTask = task({
  id: "full-synthesis",
  queue: fullSynthesisQueue,
  run: async (payload: FullSynthesisPayload) => {
    const { userId, workspaceId, spaceId, triggerSource = "auto" } = payload;

    logger.info("Starting full synthesis", {
      userId,
      workspaceId,
      spaceId,
      triggerSource,
    });

    try {
      // Update status to processing
      await updateSpaceStatus(spaceId, SPACE_STATUS.PROCESSING, {
        userId,
        operation: "full-synthesis",
        metadata: { triggerSource, phase: "start" },
      });

      // Get space data
      const space = await getSpace(spaceId, userId);

      if (!space) {
        throw new Error(`Space not found: ${spaceId}`);
      }

      // Determine generation mode
      const mode = determineMode(space);

      logger.info("Synthesis mode determined", {
        spaceId,
        summaryType: space.summaryType,
        mode,
      });

      // Get episodes for synthesis
      let episodes = await getSpaceEpisodes(spaceId, userId);

      if (episodes.length === 0) {
        logger.warn("No episodes found for synthesis", { spaceId });
        await updateSpaceStatus(spaceId, SPACE_STATUS.READY, {
          userId,
          operation: "full-synthesis",
          metadata: { phase: "no_episodes" },
        });
        return { success: true, mode, episodesProcessed: 0 };
      }

      // For incremental mode, add similar episodes
      let similarEpisodes: any[] = [];
      if (mode === "incremental" && episodes.length > 0) {
        const recentEpisodeIds = episodes.slice(0, Math.min(50, episodes.length)).map(e => e.uuid);
        similarEpisodes = await findSimilarEpisodes(recentEpisodeIds, userId, 20);

        logger.info("Found similar episodes for context", {
          spaceId,
          recentCount: recentEpisodeIds.length,
          similarCount: similarEpisodes.length,
        });
      }

      // Combine episodes for synthesis
      const allEpisodes = mode === "incremental"
        ? [...episodes.slice(0, 50), ...similarEpisodes]
        : episodes;

      logger.info("Generating synthesis", {
        spaceId,
        summaryType: space.summaryType,
        episodeCount: allEpisodes.length,
        mode,
      });

      // Generate synthesis based on type
      const summary = await generateSynthesis(
        allEpisodes,
        space.summaryType || 'persona',
        mode,
        space.summary || null,
        userId,
        spaceId,
      );

      // Store the summary
      await storeSynthesisSummary(spaceId, userId, summary, allEpisodes.length, mode);

      // Update status to ready
      await updateSpaceStatus(spaceId, SPACE_STATUS.READY, {
        userId,
        operation: "full-synthesis",
        metadata: { phase: "completed", episodesProcessed: allEpisodes.length },
      });

      logger.info("Full synthesis completed", {
        spaceId,
        episodesProcessed: allEpisodes.length,
        mode,
      });

      return {
        success: true,
        mode,
        episodesProcessed: allEpisodes.length,
      };
    } catch (error) {
      logger.error("Error in full synthesis:", {
        error,
        spaceId,
      });

      await updateSpaceStatus(spaceId, SPACE_STATUS.ERROR, {
        userId,
        operation: "full-synthesis",
        metadata: {
          phase: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  },
});

/**
 * Determine whether to do full or incremental generation
 */
function determineMode(space: {
  summary?: string | null;
  episodeCountAtLastSummary?: number;
  contextCount?: number;
}): SynthesisMode {
  // No existing summary - always full
  if (!space.summary) {
    return "full";
  }

  // 500+ episodes since last summary - do full refresh
  const currentCount = space.contextCount || 0;
  const lastCount = space.episodeCountAtLastSummary || 0;
  const newEpisodes = currentCount - lastCount;

  if (newEpisodes >= 500) {
    return "full";
  }

  // Otherwise incremental
  return "incremental";
}

/**
 * Generate synthesis based on type
 */
async function generateSynthesis(
  episodes: any[],
  summaryType: string,
  mode: SynthesisMode,
  existingSummary: string | null,
  userId: string,
  spaceId: string,
): Promise<string> {
  switch (summaryType) {
    case "persona":
      return await generatePersonaSummary(episodes, mode, existingSummary, userId, spaceId);

    case "evolution":
      // TODO: Implement evolution synthesis
      throw new Error("Evolution synthesis not yet implemented");

    case "agent":
      // TODO: Implement agent synthesis
      throw new Error("Agent synthesis not yet implemented");

    default:
      throw new Error(`Unknown synthesis type: ${summaryType}`);
  }
}

/**
 * Store the synthesis summary in Neo4j
 */
async function storeSynthesisSummary(
  spaceId: string,
  userId: string,
  summary: string,
  episodeCount: number,
  mode: SynthesisMode,
) {
  const query = `
    MATCH (space:Space {uuid: $spaceId, userId: $userId})
    SET space.summary = $summary,
        space.episodeCountAtLastSummary = $episodeCount,
        space.summaryGeneratedAt = datetime(),
        space.lastFullRefreshAt = CASE
          WHEN $mode = 'full' THEN datetime()
          ELSE space.lastFullRefreshAt
        END,
        space.updatedAt = datetime()
    RETURN space
  `;

  await runQuery(query, {
    spaceId,
    userId,
    summary,
    episodeCount,
    mode,
  });

  logger.info("Stored synthesis summary", {
    spaceId,
    summaryLength: summary.length,
    episodeCount,
    mode,
  });
}
