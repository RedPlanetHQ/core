import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";

/**
 * GET /api/v1/page/:pageId/content
 *   → { html: string | null }
 *
 * Returns the page's TipTap doc rendered as HTML. Verifies the caller's
 * workspace matches the page's workspace before returning content — the raw
 * Yjs doc still lives behind hocuspocus, this endpoint just exposes the last
 * persisted DB snapshot for read-only surfaces like the CLI scratchpad view.
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    params: z.object({ pageId: z.string() }),
  },
  async ({ authentication, params }) => {
    const pageId = params!.pageId;
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { workspaceId: true },
    });
    if (!page || page.workspaceId !== authentication.workspaceId) {
      return json({ error: "Not found" }, { status: 404 });
    }

    const html = await getPageContentAsHtml(pageId);
    return json({ html });
  },
);

export { loader };
