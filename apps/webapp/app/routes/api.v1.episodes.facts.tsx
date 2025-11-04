import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  getEpisodeStatements,
  getStatementsInvalidatedByEpisode,
} from "~/services/graphModels/episode";

// Schema for query parameters
const FactsQuerySchema = z.object({
  episodeIds: z.string(), // Comma-separated episode IDs
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: FactsQuerySchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const userId = authentication.userId;
    const episodeIdsParam = searchParams.episodeIds;

    if (!episodeIdsParam) {
      return json(
        { success: false, error: "Episode IDs are required" },
        { status: 400 },
      );
    }

    try {
      // Parse comma-separated episode IDs
      const episodeIds = episodeIdsParam.split(",").map((id) => id.trim());

      // Fetch facts and invalid facts for all episodes in parallel
      const resultsPromises = episodeIds.map(async (episodeId) => {
        const [facts, invalidFacts] = await Promise.all([
          getEpisodeStatements({
            episodeUuid: episodeId,
            userId,
          }),
          getStatementsInvalidatedByEpisode({
            episodeUuid: episodeId,
            userId,
          }),
        ]);

        return {
          episodeId,
          facts: facts.map((fact) => ({
            uuid: fact.uuid,
            fact: fact.fact,
            createdAt: fact.createdAt.toISOString(),
            validAt: fact.validAt.toISOString(),
            invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
            attributes: fact.attributes,
          })),
          invalidFacts: invalidFacts.map((fact) => ({
            uuid: fact.uuid,
            fact: fact.fact,
            createdAt: fact.createdAt.toISOString(),
            validAt: fact.validAt.toISOString(),
            invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
            attributes: fact.attributes,
          })),
        };
      });

      const results = await Promise.all(resultsPromises);

      return json({
        success: true,
        results, // Array of { episodeId, facts, invalidFacts }
      });
    } catch (error: any) {
      console.error("Error fetching episode facts:", error);
      return json(
        { success: false, error: "Failed to fetch episode facts" },
        { status: 500 },
      );
    }
  },
);
