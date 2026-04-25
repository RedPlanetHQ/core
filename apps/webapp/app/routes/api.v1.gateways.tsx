import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { getGatewayAgents } from "~/services/agent/gateway";
import { registerGateway } from "~/services/gateway/register.server";

const RegisterBodySchema = z.object({
  intent: z.literal("register"),
  baseUrl: z.string().url(),
  securityKey: z.string().min(10),
  /** Optional — derived from the gateway's manifest when omitted. */
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
});

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

/**
 * POST /api/v1/gateways
 * body: { intent: "register", name, baseUrl, securityKey, description? }
 *
 * Verifies the gateway is reachable + holds the matching key, then
 * persists the Gateway row with the securityKey encrypted at rest.
 */
const { action } = createHybridActionApiRoute(
  {
    body: RegisterBodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    if (!authentication.workspaceId || !authentication.userId) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await registerGateway({
      name: body.name,
      description: body.description,
      baseUrl: body.baseUrl,
      securityKey: body.securityKey,
      workspaceId: authentication.workspaceId as string,
      userId: authentication.userId as string,
    });

    if (!result.ok) {
      return json({ error: result.error }, { status: 400 });
    }

    return json({ gatewayId: result.gatewayId });
  },
);

export { loader, action };
