import { logger } from "~/services/logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { enqueuePersonaGeneration } from "~/lib/queue-adapter.server";
import { prisma } from "~/db.server";
import { getDocumentsByTitle } from "~/services/graphModels/document";
import { LabelService } from "~/services/label.server";

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
    const labelService = new LabelService();
    const personaDocument = await getDocumentsByTitle(userId, "Persona");

    if (!personaDocument) {
      logger.debug("No persona document found for user", { userId });
      return { triggered: false, reason: "no_persona_document" };
    }

    const label = await labelService.getLabelByName("Persona", workspaceId);

    if (!label) {
      logger.debug("No label found for persona document", { userId });
      return { triggered: false, reason: "no_label" };
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
      personaDocumentId: personaDocument[0].uuid,
    });

    // Trigger persona generation every 50 episodes
    const PERSONA_UPDATE_THRESHOLD = 50;

    if (episodeCount >= PERSONA_UPDATE_THRESHOLD) {
      logger.info("Enqueuing persona generation (threshold met)", {
        userId,
        personaDocumentId: personaDocument[0].uuid,
        episodeCount,
        threshold: PERSONA_UPDATE_THRESHOLD,
      });

      const mode = personaDocument[0].originalContent ? "incremental" : "full";

      await enqueuePersonaGeneration({
        userId,
        workspaceId,
        labelId: label.id,
        mode,
        startTime: lastPersonaGenerationAt,
      });

      await updateLastPersonaGenerationTime(workspaceId);
      logger.info("Persona generation job enqueued", {
        userId,
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
