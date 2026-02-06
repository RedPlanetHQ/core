import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SearchService } from "~/services/search.server";
import { json } from "@remix-run/node";
import { trackFeatureUsage } from "~/services/telemetry.server";

export const SearchBodyRequest = z.object({
  query: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),

  // These are not supported yet, but need to support these
  labelIds: z.array(z.string()).default([]),
  limit: z.number().optional(),
  maxBfsDepth: z.number().optional(),
  includeInvalidated: z.boolean().optional(),
  entityTypes: z.array(z.string()).optional(),
  scoreThreshold: z.number().optional(),
  minResults: z.number().optional(),
  adaptiveFiltering: z.boolean().default(true),
  structured: z.boolean().default(true),
  sortBy: z.enum(["relevance", "recency"]).optional(),
});

const searchService = new SearchService();
const { action, loader } = createHybridActionApiRoute(
  {
    body: SearchBodyRequest,
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const results = await searchService.search(
      body.query,
      authentication.userId,
      authentication.workspaceId!,
      {
        startTime: body.startTime ? new Date(body.startTime) : undefined,
        endTime: body.endTime ? new Date(body.endTime) : undefined,
        limit: body.limit,
        maxBfsDepth: body.maxBfsDepth,
        includeInvalidated: body.includeInvalidated,
        entityTypes: body.entityTypes,
        scoreThreshold: body.scoreThreshold,
        minResults: body.minResults,
        labelIds: body.labelIds,
        adaptiveFiltering: body.adaptiveFiltering,
        structured: body.structured,
        sortBy: body.sortBy,
      },
    );

    // Track search
    trackFeatureUsage("search_performed", authentication.userId).catch(
      console.error,
    );

    return json(results);
  },
);

export { action, loader };
