import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";
import { createSpace } from "~/services/graphModels/space";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { triggerSpaceAssignment } from "~/trigger/spaces/space-assignment";

const spaceService = new SpaceService();

// Schema for space ID parameter
const SpaceParamsSchema = z.object({
  spaceId: z.string(),
});

const { loader, action } = createActionApiRoute(
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

    // Verify space exists and belongs to user
    const space = await prisma.space.findUnique({
      where: {
        id: spaceId,
      },
    });
    if (!space) {
      return json({ error: "Space not found" }, { status: 404 });
    }

    // Get statements in the space
    await spaceService.deleteSpace(spaceId, userId);

    await createSpace(
      space.id,
      space.name.trim(),
      space.description?.trim(),
      userId,
    );

    logger.info(`Created space ${space.id} successfully`);

    // Trigger automatic LLM assignment for the new space
    try {
      await triggerSpaceAssignment({
        userId: userId,
        workspaceId: space.workspaceId,
        mode: "new_space",
        newSpaceId: space.id,
        batchSize: 25, // Analyze recent statements for the new space
      });

      logger.info(`Triggered LLM space assignment for new space ${space.id}`);
    } catch (error) {
      // Don't fail space creation if LLM assignment fails
      logger.warn(
        `Failed to trigger LLM assignment for space ${space.id}:`,
        error as Record<string, unknown>,
      );
    }

    return json(space);
  },
);

export { loader, action };
