import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getCommentById, resolveComment } from "~/services/butler-comment.server";

const ParamsSchema = z.object({ pageId: z.string(), commentId: z.string() });

const { loader, action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    params: ParamsSchema,
  },
  async ({ authentication, params, request }) => {
    const commentId = params.commentId;
    if (!commentId) return json({ error: "Missing commentId" }, { status: 400 });

    const comment = await getCommentById(commentId);
    if (!comment || comment.workspaceId !== authentication.workspaceId) {
      return json({ error: "Not found" }, { status: 404 });
    }

    const body = (await request.json()) as { resolved?: boolean };
    if (body.resolved === true) {
      const updated = await resolveComment(commentId);
      return json(updated);
    }

    return json({ error: "No valid update" }, { status: 400 });
  },
);

export { loader, action };
