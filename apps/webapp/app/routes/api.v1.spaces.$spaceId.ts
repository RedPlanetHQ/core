import { z } from "zod";
import {
  createActionApiRoute,
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";
import { apiCors } from "~/utils/apiCors";

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
const { action } = createHybridActionApiRoute(
  {
    params: SpaceParamsSchema,
    body: UpdateSpaceSchema.optional(),
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ authentication, params, body, request }) => {
    const userId = authentication.userId;
    const { spaceId } = params;

    if (request.method === "PUT") {
      // Update space
      if (!body || Object.keys(body).length === 0) {
        return json({ error: "No updates provided" }, { status: 400 });
      }

      const parseResult = UpdateSpaceSchema.safeParse(body);
      if (!parseResult.success) {
        return json(
          { error: "Invalid update data", details: parseResult.error.errors },
          { status: 400 },
        );
      }

      const updates: any = {};
      if (parseResult.data.name !== undefined)
        updates.name = parseResult.data.name;

      if (parseResult.data.description !== undefined)
        updates.description = parseResult.data.description;

      const space = await spaceService.updateSpace(spaceId, updates, userId);
      return json({ space, success: true });
    }

    if (request.method === "DELETE") {
      try {
        // Delete space
        await spaceService.deleteSpace(spaceId, userId);

        return json({
          success: true,
          message: "Space deleted successfully",
        });
      } catch (e) {
        return json({ error: e }, { status: 400 });
      }
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  },
);

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    params: SpaceParamsSchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, request, params }) => {
    if (request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    // Get space details
    const space = await spaceService.getSpace(
      params.spaceId,
      authentication.userId,
    );

    if (!space) {
      return json({ error: "Space not found" }, { status: 404 });
    }

    return json({ space });
  },
);

export { action, loader };
