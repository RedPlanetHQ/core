import { logger } from "~/services/logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { enqueuePersonaGeneration } from "~/lib/queue-adapter.server";
import { prisma } from "~/db.server";

interface WorkspaceMetadata {
  lastPersonaGenerationAt?: string;
  [key: string]: any;
}

async function updateLastPersonaGenerationTime(
  workspaceId: string,
): Promise<void> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      logger.warn(`Workspace not found: ${workspaceId}`);
      return;
    }

    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        metadata: {
          ...metadata,
          lastPersonaGenerationAt: new Date().toISOString(),
        },
      },
    });

    logger.info(
      `[Persona Generation] Updated last generation timestamp for workspace: ${workspaceId}`,
    );
  } catch (error) {
    logger.error(
      `[Persona Generation] Error updating last generation timestamp:`,
      { error },
    );
  }
}

/**
 * Check if persona space needs update and trigger generation if threshold met
 *
 * Called after episode ingestion to check if we've accumulated enough new episodes
 * to warrant a persona refresh (threshold: 50 episodes)
 */
export async function checkAndTriggerPersonaUpdate(
  userId: string,
  workspaceId: string,
): Promise<{ triggered: boolean; reason?: string }> {
  try {
    const personaSpace = await spaceService.getSpaceByName("Profile", userId);

    if (!personaSpace) {
      logger.debug("No persona space found for user", { userId });
      return { triggered: false, reason: "no_persona_space" };
    }

    // Get workspace metadata
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      logger.warn(`Workspace not found: ${workspaceId}`);
      return { triggered: false, reason: "workspace_not_found" };
    }

    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;
    const lastPersonaGenerationAt = metadata.lastPersonaGenerationAt;

    // Get current total episode count for user
    const totalEpisodesQuery = lastPersonaGenerationAt
      ? `
      MATCH (e:Episode {userId: $userId})
      WHERE e.createdAt > datetime($lastPersonaGenerationAt)
      RETURN count(e) as newEpisodeCount
    `
      : `
      MATCH (e:Episode {userId: $userId})
      RETURN count(e) as totalEpisodeCount
    `;
    const countResult = await runQuery(totalEpisodesQuery, {
      userId,
      lastPersonaGenerationAt,
    });
    const episodeCount = lastPersonaGenerationAt
      ? countResult[0]?.get("newEpisodeCount").toNumber() || 0
      : countResult[0]?.get("totalEpisodeCount").toNumber() || 0;

    logger.debug("Checking persona space update eligibility", {
      userId,
      episodeCount,
      personaSpaceId: personaSpace.id,
    });

    // Trigger persona generation every 50 episodes
    const PERSONA_UPDATE_THRESHOLD = 50;

    if (episodeCount >= PERSONA_UPDATE_THRESHOLD) {
      logger.info("Enqueuing persona generation (threshold met)", {
        userId,
        personaSpaceId: personaSpace.id,
        episodeCount,
        threshold: PERSONA_UPDATE_THRESHOLD,
      });

      const mode = personaSpace.summary ? "incremental" : "full";

      await enqueuePersonaGeneration({
        userId,
        workspaceId,
        spaceId: personaSpace.id,
        mode,
        startTime: lastPersonaGenerationAt,
      });

      await updateLastPersonaGenerationTime(workspaceId);
      logger.info("Persona generation job enqueued", {
        userId,
        personaSpaceId: personaSpace.id,
        mode,
      });

      return {
        triggered: true,
        reason: `${episodeCount} new episodes (threshold: ${PERSONA_UPDATE_THRESHOLD})`,
      };
    }

    return {
      triggered: false,
      reason: `only ${episodeCount} new episodes (threshold: ${PERSONA_UPDATE_THRESHOLD})`,
    };
  } catch (error) {
    logger.warn("Failed to check/trigger persona update:", {
      error,
      userId,
    });
    return { triggered: false, reason: "error" };
  }
}
