import { logger } from "~/services/logger.service";

import { LabelService } from "~/services/label.server";
import { prisma } from "~/trigger/utils/prisma";
import { type StatementAspect } from "@core/types";
import { getStatementsForEpisodeByAspects } from "~/services/graphModels/statement";

// Only these aspects affect the persona doc
const PERSONA_ASPECTS: StatementAspect[] = [
  "Identity",
  "Preference",
  "Directive",
];

interface WorkspaceMetadata {
  lastPersonaGenerationAt?: string;
  [key: string]: any;
}

/**
 * Check if persona needs regeneration based on the ingested episode's statements.
 *
 * Queries Neo4j for statements linked to the given episode and checks if any
 * have persona-relevant aspects (Identity, Preference, Directive).
 * If no episodeUuid is provided (e.g. test route), falls back to generating.
 *
 * Returns labelId and mode if generation should proceed, null otherwise.
 */
export async function checkPersonaUpdateThreshold(
  userId: string,
  workspaceId: string,
  episodeUuid?: string,
): Promise<{
  shouldGenerate: boolean;
  labelId?: string;
  mode?: "full" | "incremental";
  startTime?: string;
  reason?: string;
}> {
  try {
    const labelService = new LabelService();

    // Check if persona ingestion exists in queue
    const personaSessionId = `persona-v2-${workspaceId}`;
    const latestPersona = await prisma.ingestionQueue.findFirst({
      where: {
        sessionId: personaSessionId,
        workspaceId,
        status: "COMPLETED",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        output: true,
      },
    });

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
        return { shouldGenerate: false, reason: "failed_to_create_label" };
      }
    }

    // First generation: always generate if no persona exists yet
    if (!latestPersona) {
      logger.info("No existing persona found, triggering first generation", {
        userId,
        workspaceId,
      });
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "full",
        reason: "no existing persona",
      };
    }

    // Get workspace metadata for last generation timestamp
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });

    if (!workspace) {
      logger.warn(`Workspace not found: ${workspaceId}`);
      return { shouldGenerate: false, reason: "workspace_not_found" };
    }

    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;
    const lastPersonaGenerationAt = metadata.lastPersonaGenerationAt;

    if (!lastPersonaGenerationAt) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "full",
        reason: "no last generation timestamp",
      };
    }

    // If no episodeUuid provided (e.g. test route), always generate
    if (!episodeUuid) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: "no episodeUuid provided (manual trigger)",
      };
    }

    // Check if this episode produced any persona-relevant statements
    const personaStatements = await getStatementsForEpisodeByAspects(
      episodeUuid,
      PERSONA_ASPECTS,
    );

    logger.debug("Checking persona update - episode statement aspects", {
      userId,
      episodeUuid,
      personaStatementCount: personaStatements.length,
      aspects: PERSONA_ASPECTS,
    });

    if (personaStatements.length > 0) {
      logger.info(
        "Episode has persona-relevant statements, triggering regen",
        {
          userId,
          episodeUuid,
          personaStatementCount: personaStatements.length,
          statementAspects: personaStatements.map((s) => s.aspect),
        },
      );

      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: `episode ${episodeUuid} has ${personaStatements.length} persona-relevant statements (Identity/Preference/Directive)`,
      };
    }

    return {
      shouldGenerate: false,
      reason: `episode ${episodeUuid} has no Identity/Preference/Directive statements`,
    };
  } catch (error) {
    logger.warn("Failed to check persona update threshold:", {
      error,
      userId,
    });
    return { shouldGenerate: false, reason: "error" };
  }
}
