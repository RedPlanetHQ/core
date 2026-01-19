import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { json } from "@remix-run/node";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { memoryAgent } from "~/services/agent/memory";
import { logger } from "~/services/logger.service";

export const MemoryAgentBodyRequest = z.object({
  intent: z
    .string()
    .describe(
      "Natural language description of what memory context you need. The agent will analyze this intent and perform multiple parallel searches when needed.",
    ),
  source: z
    .string()
    .optional()
    .default("api")
    .describe("Source of the request for tracking purposes"),
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: MemoryAgentBodyRequest,
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    logger.info(
      `[API] Memory agent request from user ${authentication.userId}: "${body.intent}"`,
    );

    const startTime = Date.now();

    // Execute memory agent
    const result = await memoryAgent({
      intent: body.intent,
      userId: authentication.userId,
      source: body.source,
    });

    // Format episodes as readable text
    const episodeText = result.episodes
      .map((episode, index) => {
        return `### Episode ${index + 1}\n**UUID**: ${episode.uuid}\n**Created**: ${new Date(episode.createdAt).toLocaleString()}\n${episode.relevanceScore ? `**Relevance**: ${episode.relevanceScore}\n` : ""}\n${episode.content}`;
      })
      .join("\n\n");

    const executionTime = Date.now() - startTime;

    // Track feature usage
    trackFeatureUsage("memory_agent_search", authentication.userId).catch(
      console.error,
    );

    return json({
      response:
        episodeText || "No relevant episodes found for this intent in memory.",
      executionTimeMs: executionTime,
    });
  },
);

export { action, loader };
