import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";
import { logger } from "~/services/logger.service";
import { enqueueSpaceAssignment } from "~/lib/queue-adapter.server";

// Schema for space ID parameter
const SpaceParamsSchema = z.object({
  spaceId: z.string(),
});

const { loader, action } = createHybridActionApiRoute(
  {
    params: SpaceParamsSchema,
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ authentication, params }) => {
    const userId = authentication.userId;
    const { spaceId } = params;
    const spaceService = new SpaceService();

    // Reset the space (clears all assignments, summary, and metadata)
    const space = await spaceService.resetSpace(spaceId, userId);

    logger.info(`Reset space ${space.id} successfully`);

    // Trigger automatic episode assignment for the reset space
    try {
      await enqueueSpaceAssignment({
        userId: userId,
        workspaceId: space.workspaceId,
        mode: "new_space",
        newSpaceId: space.id,
        batchSize: 20, // Analyze recent episodes for reassignment
      });

      logger.info(`Triggered space assignment for reset space ${space.id}`);
    } catch (error) {
      // Don't fail space reset if assignment fails
      logger.warn(
        `Failed to trigger assignment for space ${space.id}:`,
        error as Record<string, unknown>,
      );
    }

    return json(space);
  },
);

export { loader, action };
