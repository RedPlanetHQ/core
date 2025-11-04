import { json, type LoaderFunctionArgs } from "@remix-run/node";
import z from "zod";
import { prisma } from "~/db.server";
import { getSpacesForEpisodes } from "~/services/graphModels/space";
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
        .map((entry) => {
          const logData = entry.data as any;
          const episodeUUID = (entry.output as any)?.episodeUuid;

          if (!episodeUUID) return null;

          return {
            uuid: episodeUUID,
            content:
              entry.activity?.text ||
              logData?.episodeBody ||
              logData?.text ||
              "No content",
            createdAt: entry.createdAt.toISOString(),
            ingestionQueueId: entry.id,
          };
        })
        .filter((ep) => ep !== null);

      // Get space IDs for all episodes
      const episodeIds = episodes.map((e) => e.uuid);
      const spacesMap = await getSpacesForEpisodes(episodeIds, userId);

      // Add space IDs to each episode
      const episodesWithSpaces = episodes.map((episode) => ({
        ...episode,
        spaceIds: spacesMap[episode.uuid] || [],
      }));

      return json({ episodes: episodesWithSpaces });
    } catch (error: any) {
      console.error("Error fetching session episodes:", error);
      return json({ error: error.message }, { status: 500 });
    }
  },
);
