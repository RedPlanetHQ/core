import { json } from "@remix-run/node";
import { logger } from "~/services/logger.service";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { LabelService } from "~/services/label.server";
import { ProviderFactory } from "@core/providers";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    try {

      const labelService = new LabelService();
      const graphProvider = ProviderFactory.getGraphProvider();

      // Get clustered graph data and cluster metadata in parallel
      const [graphData, clusters] = await Promise.all([
        graphProvider.getClusteredGraphData(authentication.userId),
        labelService.getWorkspaceLabels(authentication.workspaceId as string),
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
