import { z } from "zod";
import { json } from "@remix-run/node";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { deleteEpisodeWithRelatedNodes } from "~/services/graphModels/episode";

export const DeleteEpisodeBodyRequest = z.object({
  episodeUuid: z.string().uuid("Episode UUID must be a valid UUID"),
});

const { action, loader } = createActionApiRoute(
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
      const result = await deleteEpisodeWithRelatedNodes({
        episodeUuid: body.episodeUuid,
        userId: authentication.userId,
      });

      if (!result.episodeDeleted) {
        return json(
          { 
            error: "Episode not found or unauthorized",
            code: "not_found"
          },
          { status: 404 }
        );
      }

      return json({
        success: true,
        message: "Episode deleted successfully",
        deleted: {
          episode: result.episodeDeleted,
          statements: result.statementsDeleted,
          entities: result.entitiesDeleted,
          facts: result.factsDeleted,
        },
      });
    } catch (error) {
      console.error("Error deleting episode:", error);
      return json(
        { 
          error: "Failed to delete episode",
          code: "internal_error"
        },
        { status: 500 }
      );
    }
  },
);

export { action, loader };