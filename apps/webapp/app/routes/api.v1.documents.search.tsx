import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { searchDocuments, searchDocumentSessionIds } from "~/services/document.server";

const SearchQuerySchema = z.object({
  q: z.string().optional(),
  labelIds: z.string().optional(), // comma-separated
  limit: z.coerce.number().optional(),
  mode: z.enum(["full", "sessionIds"]).optional().default("full"),
});

const loader = createHybridLoaderApiRoute(
  {
    params: z.object({}),
    findResource: async () => 1,
    corsStrategy: "all",
    allowJWT: true,
  },
  async ({ request, authentication }) => {
    const url = new URL(request.url);
    const parseResult = SearchQuerySchema.safeParse({
      q: url.searchParams.get("q") || undefined,
      labelIds: url.searchParams.get("labelIds") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      mode: url.searchParams.get("mode") || undefined,
    });

    if (!parseResult.success) {
      return json({ error: "Invalid search parameters" }, { status: 400 });
    }

    const { q, labelIds: labelIdsStr, limit, mode } = parseResult.data;

    // Parse comma-separated labelIds
    const labelIds = labelIdsStr
      ? labelIdsStr.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;

    // Require at least one search parameter
    if (!q && (!labelIds || labelIds.length === 0)) {
      return json({ error: "Provide q or labelIds parameter" }, { status: 400 });
    }

    const workspaceId = authentication.workspaceId as string;

    if (mode === "sessionIds") {
      // Optimized mode for graph filtering
      const sessionIds = await searchDocumentSessionIds(workspaceId, {
        query: q,
        labelIds,
        limit,
      });

      return json({ sessionIds, count: sessionIds.length });
    }

    // Full mode for cmd+k search
    const documents = await searchDocuments(workspaceId, {
      query: q,
      labelIds,
      limit,
    });

    return json({ documents, count: documents.length });
  },
);

export { loader };
