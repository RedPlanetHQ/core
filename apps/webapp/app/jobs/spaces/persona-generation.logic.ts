import { logger } from "~/services/logger.service";
import { type z } from "zod";

import { prisma } from "~/trigger/utils/prisma";
import { checkPersonaUpdateThreshold } from "./persona-trigger.logic";
import { type IngestBodyRequest } from "~/trigger/ingest/ingest";

// Import aspect-based persona generation
import {
  generateAspectBasedPersona,
  generateIncrementalPersona,
} from "./aspect-persona-generation";
import { savePersonaDocument } from "./utils";
import { getPersonaDocumentForUser } from "~/services/document.server";

// Payload for BullMQ worker
export interface PersonaGenerationPayload {
  userId: string;
  workspaceId: string;
  episodeUuid?: string;
}

export interface PersonaGenerationResult {
  success: boolean;
  labelId: string;
  mode: string;
  summaryLength: number;
  episodesProcessed: number;
}

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
 * Process persona generation job (BullMQ worker entry point)
 * Orchestrates fetching data, calling generation logic, and updating database
 *
 * Uses aspect-based persona generation which leverages the knowledge graph
 * structure directly (statements grouped by aspect with provenance episodes).
 *
 * @param addToQueue - Function to add items to ingestion queue (not used for persona, kept for API compatibility)
 */
export async function processPersonaGeneration(
  payload: PersonaGenerationPayload,
  addToQueue: (
    body: z.infer<typeof IngestBodyRequest>,
    userId: string,
    activityId?: string,
    ingestionQueueId?: string,
  ) => Promise<{ id?: string }>,
): Promise<PersonaGenerationResult> {
  const { userId, workspaceId, episodeUuid } = payload;

  logger.info("Checking persona generation threshold", {
    userId,
    workspaceId,
    episodeUuid,
  });

  // Check threshold first - early return if not met
  const thresholdCheck = await checkPersonaUpdateThreshold(
    userId,
    workspaceId,
    episodeUuid,
  );

  if (!thresholdCheck.shouldGenerate) {
    logger.info("Persona generation skipped - threshold not met", {
      userId,
      workspaceId,
      reason: thresholdCheck.reason,
    });
    return {
      success: false,
      labelId: thresholdCheck.labelId || "",
      mode: thresholdCheck.mode || "full",
      summaryLength: 0,
      episodesProcessed: 0,
    };
  }
  if (!thresholdCheck.labelId || !thresholdCheck.mode) {
    logger.info("Persona generation skipped - missing threshold check values", {
      userId,
      workspaceId,
      reason: thresholdCheck.reason,
    });
    return {
      success: false,
      labelId: thresholdCheck.labelId || "",
      mode: thresholdCheck.mode || "full",
      summaryLength: 0,
      episodesProcessed: 0,
    };
  }

  // Use values from threshold check
  const { labelId, mode } = thresholdCheck;

  logger.info("Starting aspect-based persona generation (threshold met)", {
    userId,
    workspaceId,
    labelId,
    mode,
    reason: thresholdCheck.reason,
  });

  try {
    let summary: string;

    if (mode === "full" || !episodeUuid) {
      // Full generation: no existing persona or explicit full mode
      logger.info("Running full persona generation", { userId, mode });
      summary = await generateAspectBasedPersona(userId);
    } else {
      // Incremental: existing persona + episode with persona-relevant statements
      const existingPersona = await getPersonaDocumentForUser(workspaceId);

      if (!existingPersona) {
        // Fallback to full if no existing doc found
        logger.info(
          "No existing persona doc found, falling back to full generation",
          { userId },
        );
        summary = await generateAspectBasedPersona(userId);
      } else {
        logger.info("Running incremental persona generation", {
          userId,
          episodeUuid,
        });
        summary = await generateIncrementalPersona(
          userId,
          episodeUuid,
          existingPersona,
        );
      }
    }

    // Save persona directly to Document table (NOT to the graph)
    // The persona is derived FROM the graph, so ingesting it would create
    // circular/redundant data. We only store it for display/retrieval.
    await savePersonaDocument(workspaceId, userId, summary, labelId);

    await updateLastPersonaGenerationTime(workspaceId);

    logger.info("Aspect-based persona generation completed", {
      userId,
      labelId,
      mode,
      summaryLength: summary.length,
    });

    return {
      success: true,
      labelId,
      mode,
      summaryLength: summary.length,
      episodesProcessed: 0, // Not applicable for aspect-based approach
    };
  } catch (error) {
    logger.error("Error in persona generation:", {
      error,
      userId,
      labelId,
      mode,
    });
    throw error;
  }
}
