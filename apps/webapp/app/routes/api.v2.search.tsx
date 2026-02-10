import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { json } from "@remix-run/node";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { searchMemoryWithAgent } from "~/services/agent/memory";


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
    const results = await searchMemoryWithAgent(body.query, authentication.userId, authentication.workspaceId!, "api", {
      startTime: body.startTime ? new Date(body.startTime) : undefined,
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      limit: body.limit,
      labelIds: body.labelIds,
      structured: body.structured,
      sortBy: body.sortBy,
      fallbackThreshold: body.scoreThreshold,
      adaptiveFiltering: body.adaptiveFiltering,
    });

    // Track search
    trackFeatureUsage("search_performed", authentication.userId).catch(
      console.error,
    );

    // When structured: false, extract text from MCP format
    if (!body.structured && results.content) {
      return json({ text: results.content[0]?.text ?? "" });
    }

    return json(results);
  },
);

export { action, loader };
