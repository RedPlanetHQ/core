import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { ClusteringService } from "~/services/clustering.server";
import { logger } from "~/services/logger.service";
import { requireUser } from "~/services/session.server";

const clusteringService = new ClusteringService();

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const user = await requireUser(request);
    const { clusterId } = params;
    
    if (!clusterId) {
      return json(
        { success: false, error: "Cluster ID is required" },
        { status: 400 }
      );
    }
    
    const statements = await clusteringService.getClusterStatements(clusterId, user.id);
    
    return json({
      success: true,
      data: {
        clusterId,
        statements
      }
    });
    
  } catch (error) {
    logger.error("Error fetching cluster statements:", { error });
    return json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}