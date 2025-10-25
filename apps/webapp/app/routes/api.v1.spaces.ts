import { z } from "zod";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { apiCors } from "~/utils/apiCors";
import { isTriggerDeployment } from "~/lib/queue-adapter.server";

const spaceService = new SpaceService();

// Schema for creating spaces
const CreateSpaceSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

// Search query schema
const SearchParamsSchema = z.object({
  q: z.string().optional(),
});

const { action } = createHybridActionApiRoute(
  {
    body: CreateSpaceSchema,
    allowJWT: true,
    authorization: {
      action: "manage",
    },
    corsStrategy: "all",
  },
  async ({ authentication, body, request }) => {
    const user = await prisma.user.findUnique({
      where: {
        id: authentication.userId,
      },
      include: {
        Workspace: true,
      },
    });

    if (!isTriggerDeployment()) {
      return json(
        { error: "Spaces don't work in non trigger deployment" },
        { status: 400 },
      );
    }

    if (!user?.Workspace?.id) {
      throw new Error(
        "Workspace ID is required to create an ingestion queue entry.",
      );
    }

    if (request.method === "POST") {
      // Create space
      if (!body || !("name" in body)) {
        return json({ error: "Name is required" }, { status: 400 });
      }

      if (body.name.toLowerCase() === "profile") {
        return json(
          { error: "Can't create space with name Profile" },
          { status: 400 },
        );
      }

      const space = await spaceService.createSpace({
        name: body.name,
        description: body.description,
        userId: authentication.userId,
        workspaceId: user.Workspace.id,
      });

      return json({ space, success: true });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  },
);

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: SearchParamsSchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, request, searchParams }) => {
    if (request.method.toUpperCase() === "OPTIONS") {
      return apiCors(request, json({}));
    }

    const user = await prisma.user.findUnique({
      where: {
        id: authentication.userId,
      },
      include: {
        Workspace: true,
      },
    });

    if (!user?.Workspace?.id) {
      throw new Error(
        "Workspace ID is required to create an ingestion queue entry.",
      );
    }

    // List/search spaces
    if (searchParams?.q) {
      const spaces = await spaceService.searchSpacesByName(
        searchParams.q,
        user?.Workspace?.id,
      );
      return json({ spaces });
    } else {
      const spaces = await spaceService.getUserSpaces(user.id);
      return json({ spaces });
    }
  },
);

export { action, loader };
