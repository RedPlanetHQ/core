import { queue, task } from "@trigger.dev/sdk/v3";
import { python } from "@trigger.dev/python";
import { logger } from "~/services/logger.service";
import {
  processPersonaGeneration,
  type PersonaGenerationPayload,
} from "~/jobs/spaces/persona-generation.logic";

export type { PersonaGenerationPayload };

/**
 * Python runner for Trigger.dev using python.runScript (clustering)
 */
async function runClusteringWithTriggerPython(
  userId: string,
  startTime?: string,
): Promise<string> {
  const args = [userId, "--json"];

  // Add time filter if provided
  if (startTime) {
    args.push("--start-time", startTime);
  }

  logger.info(
    "[Trigger.dev] Running HDBSCAN clustering with python.runScript",
    {
      userId,
      startTime,
      args: args.join(" "),
    },
  );

  const result = await python.runScript("./python/main.py", args);
  return result.stdout;
}

/**
 * Python runner for Trigger.dev using python.runScript (analytics)
 */
async function runAnalyticsWithTriggerPython(
  userId: string,
  startTime?: string,
): Promise<string> {
  const args = [userId, "--json"];

  // Add time filter if provided
  if (startTime) {
    args.push("--start-time", startTime);
  }

  logger.info("[Trigger.dev] Running persona analytics with python.runScript", {
    userId,
    startTime,
    args: args.join(" "),
  });

  const result = await python.runScript("./python/persona_analytics.py", args);
  return result.stdout;
}

const personaQueue = queue({
  name: "persona-generation-queue",
  concurrencyLimit: 1,
});

/**
 * Trigger.dev task for persona generation
 *
 * This is a thin wrapper around the common logic in persona-generation.logic.ts
 * Passes Trigger.dev's Python runners for both clustering and analytics
 */
export const personaGenerationTask = task({
  id: "persona-generation",
  queue: personaQueue,
  machine: "large-2x",
  maxDuration: 36000,
  run: async (payload: PersonaGenerationPayload) => {
    logger.info(`[Trigger.dev] Starting persona generation task`, {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
    });

    // Use common business logic with Trigger.dev Python runners
    return await processPersonaGeneration(
      payload,
      runClusteringWithTriggerPython,
      runAnalyticsWithTriggerPython,
    );
  },
});
