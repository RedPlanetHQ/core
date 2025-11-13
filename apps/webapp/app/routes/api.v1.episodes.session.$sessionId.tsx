import { json, type LoaderFunctionArgs } from "@remix-run/node";
import z from "zod";
import { prisma } from "~/db.server";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for space ID parameter
const SessionParamsSchema = z.object({
  sessionId: z.string(),
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    params: SessionParamsSchema,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, params }) => {
    const userId = authentication.userId;
    const sessionId = params.sessionId;

    if (!sessionId) {
      return json({ error: "Session ID is required" }, { status: 400 });
    }

    try {
      // Get user's workspace
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { Workspace: { select: { id: true } } },
      });

      if (!user?.Workspace) {
        return json({ error: "Workspace not found" }, { status: 404 });
      }

      // Fetch all ingestionQueue entries for this session
      const ingestionQueueEntries = await prisma.ingestionQueue.findMany({
        where: {
          workspaceId: user.Workspace.id,
          data: {
            path: ["sessionId"],
            equals: sessionId,
          },
          status: "COMPLETED",
        },
        select: {
          id: true,
          createdAt: true,
          output: true,
          data: true,
          activity: {
            select: {
              text: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      // Extract episode UUIDs and format episodes
      const episodes = ingestionQueueEntries
        .flatMap((entry) => {
          const logData = entry.data as any;
          const output = entry.output as any;

          // Handle CONVERSATION type - single episode
          if (logData.type === "CONVERSATION") {
            const episodeUUID = output?.episodeUuid;
            if (!episodeUUID) return [];

            return [
              {
                uuid: episodeUUID,
                id: entry.id,
                content:
                  entry.activity?.text ||
                  logData?.episodeBody ||
                  logData?.text ||
                  "No content",
                createdAt: entry.createdAt.toISOString(),
                ingestionQueueId: entry.id,
              },
            ];
          }

          // Handle DOCUMENT type - multiple episodes
          if (logData.type === "DOCUMENT") {
            const episodeUUIDs = output?.episodes || [];
            if (!Array.isArray(episodeUUIDs) || episodeUUIDs.length === 0)
              return [];

            return episodeUUIDs.map((episodeUUID: { episodeUuid: string }) => ({
              uuid: episodeUUID.episodeUuid,
              id: entry.id,
              content:
                entry.activity?.text ||
                logData?.episodeBody ||
                logData?.text ||
                "No content",
              createdAt: entry.createdAt.toISOString(),
              ingestionQueueId: entry.id,
            }));
          }

          return [];
        })
        .filter((ep) => ep !== null);

      return json({ episodes });
    } catch (error: any) {
      console.error("Error fetching session episodes:", error);
      return json({ error: error.message }, { status: 500 });
    }
  },
);
