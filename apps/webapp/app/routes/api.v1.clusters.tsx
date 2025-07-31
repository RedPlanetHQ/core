import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { logger } from "~/services/logger.service";
import { createActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { ClusteringService } from "~/services/clustering.server";

const clusteringService = new ClusteringService();


const { action, loader } = createActionApiRoute(
  {
    body: z.object({
      mode: z.enum(['auto', 'incremental', 'complete']).optional().default('auto'),
      forceComplete: z.boolean().optional().default(false)
    }),
    allowJWT: true,
    authorization: {
      action: "search",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication, request }) => {
    try {
      
      if (request.method === "POST") {
        let result;
        switch (body.mode) {
          case 'incremental':
            result = await clusteringService.performIncrementalClustering(authentication.userId);
            break;
          case 'complete':
            result = await clusteringService.performCompleteClustering(authentication.userId);
            break;
          case 'auto':
          default:
            result = await clusteringService.performClustering(authentication.userId, body.forceComplete);
            break;
        }
        
        return json({
          success: true,
          data: result
        });
      } else if (request.method === "GET") {
        const clusters = await clusteringService.getClusters(authentication.userId);
        return json({
          success: true,
          data: clusters
        });
      }
      
      return json(
        { success: false, error: "Method not allowed" },
        { status: 405 }
      );
      
    } catch (error) {
      logger.error("Error in clustering action:", { error });
      return json(
        { 
          success: false, 
          error: error instanceof Error ? error.message : "Unknown error" 
        },
        { status: 500 }
      );
    }
  },
);

export { action, loader };

