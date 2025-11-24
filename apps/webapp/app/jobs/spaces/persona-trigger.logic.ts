import { logger } from "~/services/logger.service";
import { runQuery } from "~/lib/neo4j.server";

import {
  getDocumentsByTitle,
  createPersonaDocument,
} from "~/services/graphModels/document";
import { LabelService } from "~/services/label.server";
import { prisma } from "~/trigger/utils/prisma";
interface WorkspaceMetadata {
  lastPersonaGenerationAt?: string;
  [key: string]: any;
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
  enqueuePersonaGeneration: (params: {
    userId: string;
    workspaceId: string;
    labelId: string;
    mode: "full" | "incremental";
    startTime?: string;
  }) => Promise<{ id?: string; token?: string }>,
): Promise<{ triggered: boolean; reason?: string }> {
  try {
    const labelService = new LabelService();
    let personaDocument = await getDocumentsByTitle(userId, "Persona");

    // Auto-create persona document if missing (for existing users)
    if (!personaDocument || personaDocument.length === 0) {
      logger.info("Creating missing persona document for existing user", {
        userId,
      });
      try {
        await createPersonaDocument(userId, workspaceId);
        personaDocument = await getDocumentsByTitle(userId, "Persona");
      } catch (error) {
        logger.error("Failed to create persona document", { userId, error });
        return { triggered: false, reason: "failed_to_create_document" };
      }
    }

    let label = await labelService.getLabelByName("Persona", workspaceId);

    // Auto-create Persona label if missing (for existing users)
    if (!label) {
      logger.info("Creating missing Persona label for existing user", {
        userId,
        workspaceId,
      });
      try {
        label = await labelService.createLabel({
          name: "Persona",
          workspaceId,
          color: "#009CF3",
          description: "Personal persona generated from your episodes",
        });
      } catch (error) {
        logger.error("Failed to create Persona label", {
          userId,
          workspaceId,
          error,
        });
        return { triggered: false, reason: "failed_to_create_label" };
      }
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

    // Trigger persona generation every 20 episodes
    const PERSONA_UPDATE_THRESHOLD = 20;

    if (episodeCount >= PERSONA_UPDATE_THRESHOLD || !lastPersonaGenerationAt) {
      logger.info("Enqueuing persona generation (threshold met)", {
        userId,
        personaDocumentId: personaDocument[0].uuid,
        episodeCount,
        threshold: PERSONA_UPDATE_THRESHOLD,
      });

      const mode = lastPersonaGenerationAt
        ? personaDocument[0].originalContent
          ? "incremental"
          : "full"
        : "full";

      await enqueuePersonaGeneration({
        userId,
        workspaceId,
        labelId: label.id,
        mode,
        startTime: lastPersonaGenerationAt,
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
