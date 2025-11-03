import { logger } from "~/services/logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { getSpace, getSpaceEpisodeCount } from "~/services/graphModels/space";
import { spaceSummaryTask } from "./space-summary";
import { fullSynthesisTask } from "./full-synthesis";

interface EpisodeData {
  uuid: string;
  userId: string;
  sessionId?: string;
}

/**
 * Check if any spaces need summary updates after episode ingestion
 * Triggers appropriate summary tasks based on space type
 */
export async function checkSpaceSummaryUpdates(episode: EpisodeData) {
  const { userId } = episode;

  try {
    logger.info("Checking spaces for summary updates", {
      episodeId: episode.uuid,
      userId,
    });

    // Get all affected spaces
    const spaces = await getAffectedSpaces(episode);

    logger.info(`Found ${spaces.length} affected spaces`, {
      episodeId: episode.uuid,
      spaceIds: spaces.map((s) => s.uuid),
    });

    // Check each space and trigger updates if needed
    for (const space of spaces) {
      const shouldUpdate = await shouldUpdateSummary(space);

      if (shouldUpdate) {
        await triggerSummaryUpdate(space);
      }
    }
  } catch (error) {
    logger.error("Error checking space summary updates:", {
      error,
      episodeId: episode.uuid,
    });
  }
}

/**
 * Get all spaces affected by this episode
 * Returns classification spaces (from assignments) + persona spaces (by userId)
 */
async function getAffectedSpaces(episode: EpisodeData) {
  const { userId, uuid: episodeId } = episode;

  const query = `
    // Get classification spaces (assigned episodes)
    OPTIONAL MATCH (classSpace:Space)-[:HAS_EPISODE]->(e:Episode {uuid: $episodeId, userId: $userId})
    WHERE classSpace.summaryType = 'classification' OR classSpace.summaryType IS NULL

    // Get persona spaces (all episodes for user)
    OPTIONAL MATCH (personaSpace:Space {userId: $userId})
    WHERE personaSpace.summaryType = 'persona'

    WITH collect(DISTINCT classSpace) + collect(DISTINCT personaSpace) as allSpaces
    UNWIND allSpaces as space
    WHERE space IS NOT NULL
    RETURN DISTINCT
      space.uuid as uuid,
      space.userId as userId,
      space.summaryType as summaryType,
      space.episodeCountAtLastSummary as episodeCountAtLastSummary,
      space.summaryUpdateThreshold as summaryUpdateThreshold
  `;

  const result = await runQuery(query, { episodeId, userId });

  return result.map((record) => ({
    uuid: record.get("uuid"),
    userId: record.get("userId"),
    summaryType: record.get("summaryType"),
    episodeCountAtLastSummary: record.get("episodeCountAtLastSummary") || 0,
    summaryUpdateThreshold: record.get("summaryUpdateThreshold") || 50,
  }));
}

/**
 * Check if a space needs summary update based on episode count threshold
 */
async function shouldUpdateSummary(space: {
  uuid: string;
  userId: string;
  summaryType: string | null;
  episodeCountAtLastSummary: number;
  summaryUpdateThreshold: number;
}): Promise<boolean> {
  const currentCount = await getSpaceEpisodeCount(space.uuid, space.userId);
  const newEpisodes = currentCount - space.episodeCountAtLastSummary;

  logger.info("Checking if space needs update", {
    spaceId: space.uuid,
    summaryType: space.summaryType,
    currentCount,
    lastCount: space.episodeCountAtLastSummary,
    newEpisodes,
    threshold: space.summaryUpdateThreshold,
  });

  return newEpisodes >= space.summaryUpdateThreshold;
}

/**
 * Trigger appropriate summary task based on space type
 */
async function triggerSummaryUpdate(space: {
  uuid: string;
  userId: string;
  summaryType: string | null;
}) {
  // Get full space data with workspaceId
  const fullSpace = await getSpace(space.uuid, space.userId);

  if (!fullSpace) {
    logger.warn("Space not found for summary update", {
      spaceId: space.uuid,
    });
    return;
  }

  // Get workspaceId from database
  const workspaceQuery = `
    MATCH (space:Space {uuid: $spaceId, userId: $userId})
    MATCH (w:Workspace {userId: $userId})
    RETURN w.uuid as workspaceId
    LIMIT 1
  `;

  const workspaceResult = await runQuery(workspaceQuery, {
    spaceId: space.uuid,
    userId: space.userId,
  });

  if (workspaceResult.length === 0) {
    logger.error("No workspace found for user", { userId: space.userId });
    return;
  }

  const workspaceId = workspaceResult[0].get("workspaceId");

  if (space.summaryType === 'persona' || space.summaryType === 'evolution' || space.summaryType === 'agent') {
    // Trigger synthesis task
    logger.info("Triggering full synthesis task", {
      spaceId: space.uuid,
      summaryType: space.summaryType,
    });

    await fullSynthesisTask.trigger({
      userId: space.userId,
      workspaceId,
      spaceId: space.uuid,
      triggerSource: "auto",
    });
  } else {
    // Trigger classification summary task
    logger.info("Triggering classification summary task", {
      spaceId: space.uuid,
    });

    await spaceSummaryTask.trigger({
      userId: space.userId,
      spaceId: space.uuid,
      triggerSource: "assignment",
    });
  }
}
