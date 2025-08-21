import { z } from "zod";
import {
  createHybridActionApiRoute,
  createHybridLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { SpaceService } from "~/services/space.server";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { apiCors } from "~/utils/apiCors";

const spaceService = new SpaceService();

// Schema for creating spaces
const CreateSpaceSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

// Schema for bulk operations
const BulkOperationSchema = z.object({
  intent: z.enum([
    "assign_statements",
    "remove_statements",
    "bulk_assign",
    "initialize_space_ids",
  ]),
  spaceId: z.string().optional(),
  statementIds: z.array(z.string()).optional(),
  spaceIds: z.array(z.string()).optional(),
});

// Search query schema
const SearchParamsSchema = z.object({
  q: z.string().optional(),
});

const { action } = createHybridActionApiRoute(
  {
    body: z.union([CreateSpaceSchema, BulkOperationSchema]),
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

    if (request.method === "PUT") {
      // Bulk operations
      if (!body || !("intent" in body)) {
        return json({ error: "Intent is required" }, { status: 400 });
      }

      switch (body.intent) {
        case "assign_statements": {
          if (!body.spaceId || !body.statementIds) {
            return json(
              { error: "Space ID and statement IDs are required" },
              { status: 400 },
            );
          }

          const result = await spaceService.assignStatementsToSpace(
            body.statementIds,
            body.spaceId,
            authentication.userId,
          );

          if (result.success) {
            return json({
              success: true,
              message: `Assigned ${result.statementsUpdated} statements to space`,
              statementsUpdated: result.statementsUpdated,
            });
          } else {
            return json({ error: result.error }, { status: 400 });
          }
        }

        case "remove_statements": {
          if (!body.spaceId || !body.statementIds) {
            return json(
              { error: "Space ID and statement IDs are required" },
              { status: 400 },
            );
          }

          const result = await spaceService.removeStatementsFromSpace(
            body.statementIds,
            body.spaceId,
            authentication.userId,
          );

          if (result.success) {
            return json({
              success: true,
              message: `Removed ${result.statementsUpdated} statements from space`,
              statementsUpdated: result.statementsUpdated,
            });
          } else {
            return json({ error: result.error }, { status: 400 });
          }
        }

        case "bulk_assign": {
          if (!body.statementIds || !body.spaceIds) {
            return json(
              { error: "Statement IDs and space IDs are required" },
              { status: 400 },
            );
          }

          const results = await spaceService.bulkAssignStatements(
            body.statementIds,
            body.spaceIds,
            authentication.userId,
          );

          return json({ results, success: true });
        }

        case "initialize_space_ids": {
          const updatedCount = await spaceService.initializeSpaceIds(
            authentication.userId,
          );
          return json({
            success: true,
            message: `Initialized spaceIds for ${updatedCount} statements`,
            updatedCount,
          });
        }

        default:
          return json({ error: "Invalid intent" }, { status: 400 });
      }
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
