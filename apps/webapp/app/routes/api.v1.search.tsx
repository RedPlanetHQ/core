import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SearchService } from "~/services/search.server";
import { json } from "@remix-run/node";

export const SearchBodyRequest = z.object({
  query: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),

  // These are not supported yet, but need to support these
  spaceIds: z.array(z.string()).default([]),
  limit: z.number().optional(),
  maxBfsDepth: z.number().optional(),
  includeInvalidated: z.boolean().optional(),
  entityTypes: z.array(z.string()).optional(),
  scoreThreshold: z.number().optional(),
  minResults: z.number().optional(),
});

const searchService = new SearchService();
const { action, loader } = createActionApiRoute(
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
      {
        startTime: body.startTime ? new Date(body.startTime) : undefined,
        endTime: body.endTime ? new Date(body.endTime) : undefined,
        limit: body.limit,
        maxBfsDepth: body.maxBfsDepth,
        includeInvalidated: body.includeInvalidated,
        entityTypes: body.entityTypes,
        scoreThreshold: body.scoreThreshold,
        minResults: body.minResults,
        spaceIds: body.spaceIds,
      },
    );
    return json(results);
  },
);

export { action, loader };
