import { z } from "zod";
import { json } from "@remix-run/node";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import {
  deleteLog,
  getIngestionQueue,
} from "~/services/ingestionLogs.server";


export const DeleteEpisodeBodyRequest = z.object({
  id: z.string(),
});

const { action, loader } = createHybridActionApiRoute(
  {
    body: DeleteEpisodeBodyRequest,
    allowJWT: true,
    method: "DELETE",
    authorization: {
      action: "delete",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    try {
      const ingestionQueue = await getIngestionQueue(body.id);

      if (!ingestionQueue) {
        return json(
          {
            error: "Episode not found or unauthorized",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      const result = await deleteLog(ingestionQueue.id, authentication.userId)

      if (!result.success) {
        return json(
          {
            error: result.error || "Failed to delete Episode",
            code: "not_found",
          },
          { status: 404 },
        );
      }

      return json({
        success: true,
        message: "Episode deleted successfully",
        deleted: result.deleted,
      });
    } catch (error) {
      console.error("Error deleting episode:", error);
      return json(
        {
          error: "Failed to delete Episode",
          code: "not_found",
        },
        { status: 404 },
      );
    }
  },
);

export { action, loader };
