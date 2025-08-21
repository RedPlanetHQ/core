import { json } from "@remix-run/node";
import { logger } from "~/services/logger.service";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getClusteredGraphData } from "~/lib/neo4j.server";
import { SpaceService } from "~/services/space.server";

const spaceService = new SpaceService();

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    try {
      // Get clustered graph data and cluster metadata in parallel
      const [graphData, clusters] = await Promise.all([
        getClusteredGraphData(authentication.userId),
        spaceService.getUserSpaces(authentication.userId),
      ]);

      return json({
        success: true,
        data: {
          triplets: graphData,
          clusters: clusters,
        },
      });
    } catch (error) {
      logger.error("Error in clustered graph loader:", { error });
      return json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);

export { loader };
