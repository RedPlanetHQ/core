import { logger } from "~/services/logger.service";

import { LabelService } from "~/services/label.server";
import { prisma } from "~/db.server";
import {
  type StatementAspect,
  type VoiceAspect,
  GRAPH_ASPECTS,
  VOICE_ASPECTS,
} from "@core/types";
import {
  getStatementsForEpisodeByAspects,
  getInvalidatedStatementsForEpisode,
} from "~/services/graphModels/statement";
import { getWorkspacePersona } from "~/models/workspace.server";
import {
  getVoiceAspectsForEpisode,
  getInvalidatedVoiceAspectsForEpisode,
} from "~/services/aspectStore.server";
import { PERSONA_ASPECTS } from "./persona-bullet-ops";

// Partition PERSONA_ASPECTS (single source of truth, from persona-bullet-ops)
// by storage backend. An aspect appears here iff it's both (a) persona-relevant
// and (b) actually stored in that backend.
// Graph (Neo4j): Identity is stored as SPO triples
// Voice (Postgres): Preference, Directive are stored as complete statements
const GRAPH_ASPECTS_SET = new Set<string>(GRAPH_ASPECTS);
const VOICE_ASPECTS_SET = new Set<string>(VOICE_ASPECTS);
const PERSONA_GRAPH_ASPECTS: StatementAspect[] = PERSONA_ASPECTS.filter((a) =>
  GRAPH_ASPECTS_SET.has(a),
);
const PERSONA_VOICE_ASPECTS: VoiceAspect[] = PERSONA_ASPECTS.filter(
  (a): a is VoiceAspect => VOICE_ASPECTS_SET.has(a),
);

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

    // Check both Neo4j graph statements AND Postgres voice aspects, on
    // both the valid and invalidated sides. An "invalidate-only" episode
    // (no new facts, only tombstones) must still trigger so the
    // orchestrator can append the tombstones.
    // Identity → graph (Neo4j), Preference/Directive → voice (Postgres)
    const [
      personaStatements,
      personaVoiceAspects,
      invalidatedStatements,
      invalidatedVoiceAspects,
    ] = await Promise.all([
      getStatementsForEpisodeByAspects(episodeUuid, PERSONA_GRAPH_ASPECTS),
      getVoiceAspectsForEpisode(episodeUuid, userId, PERSONA_VOICE_ASPECTS),
      getInvalidatedStatementsForEpisode(
        episodeUuid,
        userId,
        PERSONA_GRAPH_ASPECTS,
      ),
      getInvalidatedVoiceAspectsForEpisode(
        episodeUuid,
        userId,
        PERSONA_VOICE_ASPECTS,
      ),
    ]);

    const validCount =
      personaStatements.length + personaVoiceAspects.length;
    const invalidatedCount =
      invalidatedStatements.length + invalidatedVoiceAspects.length;
    const totalPersonaRelevant = validCount + invalidatedCount;

    logger.debug("Checking persona update - episode aspects", {
      userId,
      episodeUuid,
      graphStatements: personaStatements.length,
      voiceAspects: personaVoiceAspects.length,
      invalidatedStatements: invalidatedStatements.length,
      invalidatedVoiceAspects: invalidatedVoiceAspects.length,
      totalPersonaRelevant,
    });

    if (totalPersonaRelevant > 0) {
      logger.info("Episode has persona-relevant data, triggering regen", {
        userId,
        episodeUuid,
        validCount,
        invalidatedCount,
      });

      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: `episode ${episodeUuid} has ${validCount} new + ${invalidatedCount} invalidated persona-relevant facts`,
      };
    }

    return {
      shouldGenerate: false,
      reason: `episode ${episodeUuid} has no Identity/Preference/Directive new or invalidated facts`,
    };
  } catch (error) {
    logger.warn("Failed to check persona update threshold:", {
      error,
      userId,
    });
    return { shouldGenerate: false, reason: "error" };
  }
}
