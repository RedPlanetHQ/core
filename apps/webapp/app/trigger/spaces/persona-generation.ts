import { queue, task } from "@trigger.dev/sdk/v3";
import { logger } from "~/services/logger.service";
import {
  processPersonaGeneration,
  type PersonaGenerationPayload,
} from "~/jobs/spaces/persona-generation.logic";
import { addToQueue } from "../utils/queue";
import { initializeProvider } from "../utils/provider";

export type { PersonaGenerationPayload };

const personaQueue = queue({
  name: "persona-generation-queue",
  concurrencyLimit: 1,
});

/**
 * Trigger.dev task for persona generation
 *
 * Uses aspect-based persona generation which queries statements grouped by aspect
 * from the knowledge graph and uses provenance episodes for context.
 *
 * No longer requires Python scripts for BERT/HDBSCAN clustering.
 */
export const personaGenerationTask = task({
  id: "persona-generation",
  queue: personaQueue,
  machine: "large-2x",
  maxDuration: 36000,
  run: async (payload: PersonaGenerationPayload) => {
    await initializeProvider();
    logger.info(`[Trigger.dev] Starting aspect-based persona generation task`, {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
    });

    // Use aspect-based persona generation (no Python runners needed)
    return await processPersonaGeneration(payload, addToQueue);
  },
});
