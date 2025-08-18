import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";

const spaceService = new SpaceService();

// Schema for space ID parameter
const SpaceParamsSchema = z.object({
  spaceId: z.string(),
});

const { loader } = createActionApiRoute(
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
    const space = await spaceService.getSpace(spaceId, userId);
    if (!space) {
      return json({ error: "Space not found" }, { status: 404 });
    }

    // Get statements in the space
    const statements = await spaceService.getSpaceStatements(spaceId, userId);

    return json({ 
      statements,
      space: {
        uuid: space.uuid,
        name: space.name,
        statementCount: statements.length
      }
    });
  }
);

export { loader };