import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { ClusteringService } from "~/services/clustering.server";
import { logger } from "~/services/logger.service";
import { requireUser } from "~/services/session.server";

const clusteringService = new ClusteringService();

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = await requireUser(request);
    
    const driftMetrics = await clusteringService.detectClusterDrift(user.id);
    
    return json({
      success: true,
      data: driftMetrics
    });
    
  } catch (error) {
    logger.error("Error checking cluster drift:", { error });
    return json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}