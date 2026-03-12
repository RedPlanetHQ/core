import { logger } from "~/services/logger.service";

import { LabelService } from "~/services/label.server";
import { prisma } from "~/db.server";
import { type StatementAspect, type VoiceAspect } from "@core/types";
import { getStatementsForEpisodeByAspects } from "~/services/graphModels/statement";
import { getWorkspacePersona } from "~/models/workspace.server";
import { getVoiceAspectsForEpisode } from "~/services/aspectStore.server";

// Persona-relevant aspects split by storage:
// Graph (Neo4j): Identity is stored as SPO triples
// Voice (Postgres): Preference, Directive are stored as complete statements
const PERSONA_GRAPH_ASPECTS: StatementAspect[] = ["Identity"];
const PERSONA_VOICE_ASPECTS: VoiceAspect[] = ["Preference", "Directive"];

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

    // Check if persona document exists
    const latestPersona = await getWorkspacePersona(workspaceId);

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

    // Check both Neo4j graph statements AND Postgres voice aspects
    // Identity → graph (Neo4j), Preference/Directive → voice (Postgres)
    const [personaStatements, personaVoiceAspects] = await Promise.all([
      getStatementsForEpisodeByAspects(episodeUuid, PERSONA_GRAPH_ASPECTS),
      getVoiceAspectsForEpisode(episodeUuid, userId, PERSONA_VOICE_ASPECTS),
    ]);

    const totalPersonaRelevant = personaStatements.length + personaVoiceAspects.length;

    logger.debug("Checking persona update - episode aspects", {
      userId,
      episodeUuid,
      graphStatements: personaStatements.length,
      voiceAspects: personaVoiceAspects.length,
      totalPersonaRelevant,
    });

    if (totalPersonaRelevant > 0) {
      logger.info("Episode has persona-relevant data, triggering regen", {
        userId,
        episodeUuid,
        graphStatements: personaStatements.length,
        voiceAspects: personaVoiceAspects.length,
        statementAspects: personaStatements.map((s) => s.aspect),
        voiceAspectTypes: personaVoiceAspects.map((a) => a.aspect),
      });

      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: `episode ${episodeUuid} has ${personaStatements.length} graph statements + ${personaVoiceAspects.length} voice aspects (Identity/Preference/Directive)`,
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
