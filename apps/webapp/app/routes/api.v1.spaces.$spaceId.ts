import { z } from "zod";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";

const spaceService = new SpaceService();

// Schema for space ID parameter
const SpaceParamsSchema = z.object({
  spaceId: z.string(),
});

// Schema for updating spaces
const UpdateSpaceSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

const { action, loader } = createActionApiRoute(
  {
    params: SpaceParamsSchema,
    body: UpdateSpaceSchema,
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ authentication, params, body, request }) => {
    const userId = authentication.userId;
    const { spaceId } = params;

    if (request.method === "GET") {
      // Get space details
      const space = await spaceService.getSpace(spaceId, userId);
      
      if (!space) {
        return json({ error: "Space not found" }, { status: 404 });
      }

      return json({ space });
    }

    if (request.method === "PUT") {
      // Update space
      if (!body || Object.keys(body).length === 0) {
        return json({ error: "No updates provided" }, { status: 400 });
      }

      const updates: any = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;

      const space = await spaceService.updateSpace(spaceId, updates, userId);
      return json({ space, success: true });
    }

    if (request.method === "DELETE") {
      // Delete space
      const result = await spaceService.deleteSpace(spaceId, userId);
      
      if (result.deleted) {
        return json({ 
          success: true, 
          message: "Space deleted successfully",
          statementsUpdated: result.statementsUpdated 
        });
      } else {
        return json({ error: result.error }, { status: 400 });
      }
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  }
);

export { action, loader };