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
          sessionId,
        },
        select: {
          id: true,
          createdAt: true,
          output: true,
          data: true,
          status: true,
          title: true,
          labels: true,
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
          return {
            id: entry.id,
            content:
              entry.activity?.text ||
              logData?.episodeBody ||
              logData?.text ||
              "No content",
            createdAt: entry.createdAt.toISOString(),
            ingestionQueueId: entry.id,
            status: entry.status,
            title: entry.title,
            labels: entry.labels,
          };
        })
        .filter((ep) => ep !== null);

      return json({ episodes, count: episodes.length });
    } catch (error: any) {
      console.error("Error fetching session episodes:", error);
      return json({ error: error.message }, { status: 500 });
    }
  },
);
