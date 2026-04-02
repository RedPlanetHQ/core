import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getCommentsForPage } from "~/services/butler-comment.server";

const ParamsSchema = z.object({ pageId: z.string() });

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    params: ParamsSchema,
  },
  async ({ params }) => {
    const pageId = params.pageId;
    const comments = await getCommentsForPage(pageId);
    return json(comments);
  },
);

export { loader };
