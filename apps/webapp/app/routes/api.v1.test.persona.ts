import { json, type ActionFunctionArgs } from "@remix-run/node";
import { logger } from "~/services/logger.service";
import { runQuery } from "~/lib/neo4j.server";
import { generatePersonaSummary } from "~/trigger/spaces/synthesis/persona";

/**
 * Temporary API endpoint for testing persona generation
 *
 * POST /api/v1/test/persona
 * Body: { userId: string }
 *
 * Example:
 * curl -X POST http://localhost:3000/api/v1/test/persona \
 *   -H "Content-Type: application/json" \
 *   -d '{"userId":"cmc1w8xke000xo51vffqcn2mt"}'
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return json({ error: "userId is required" }, { status: 400 });
    }

    logger.info("Testing persona generation", { userId });

    // Fetch all user episodes
    const query = `
      MATCH (e:Episode {userId: $userId})
      WHERE e.content IS NOT NULL AND e.content <> ''
      RETURN e {
        .uuid,
        .content,
        .originalContent,
        .source,
        .createdAt,
        .validAt,
        .metadata,
        .sessionId
      } as episode
      ORDER BY e.createdAt DESC
    `;

    const result = await runQuery(query, { userId });

    const episodes = result.map((record) => {
      const episode = record.get("episode");
      return {
        ...episode,
        createdAt: new Date(episode.createdAt),
        validAt: new Date(episode.validAt),
      };
    });

    if (episodes.length === 0) {
      return json({
        error: "No episodes found for this user",
        userId,
      }, { status: 404 });
    }

    // Show episode breakdown
    const sourceCounts: Record<string, number> = {};
    for (const episode of episodes) {
      const source = episode.source || "unknown";
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    }

    logger.info("Episode breakdown", {
      userId,
      totalEpisodes: episodes.length,
      sources: sourceCounts,
    });

    // Generate persona (without storing to space)
    const startTime = Date.now();
    const dummySpaceId = "test-space-" + Date.now();

    const persona = await generatePersonaSummary(
      episodes,
      "full", // mode
      null, // existingSummary
      userId,
      dummySpaceId
    );

    const elapsed = Date.now() - startTime;

    logger.info("Persona generation complete", {
      userId,
      episodeCount: episodes.length,
      personaLength: persona.length,
      elapsedMs: elapsed,
    });

    return json({
      success: true,
      userId,
      stats: {
        episodeCount: episodes.length,
        sources: sourceCounts,
        elapsedMs: elapsed,
        personaLength: persona.length,
      },
      persona,
    });

  } catch (error) {
    logger.error("Error generating persona", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    return json({
      error: "Failed to generate persona",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
