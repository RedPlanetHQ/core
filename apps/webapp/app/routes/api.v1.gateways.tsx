import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getGatewayAgents } from "~/services/agent/gateway";

/**
 * GET /api/v1/gateways
 * Returns all connected gateways for the workspace.
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      throw new Error("User workspace not found");
    }

    const gateways = await getGatewayAgents(authentication.workspaceId as string);

    return json({ gateways });
  },
);

export { loader };
