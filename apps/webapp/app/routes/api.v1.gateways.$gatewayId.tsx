import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { deleteGateway } from "~/services/gateway/crud.server";

const ParamsSchema = z.object({
  gatewayId: z.string().min(1),
});

/**
 * DELETE /api/v1/gateways/:gatewayId
 *
 * Removes a gateway owned by the caller's workspace. Cascades to related
 * CodingSession rows via the Prisma relation.
 */
const { action, loader } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    method: "DELETE",
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const gateway = await prisma.gateway.findFirst({
      where: { id: params.gatewayId, workspaceId: authentication.workspaceId as string },
      select: { id: true },
    });
    if (!gateway) {
      return json({ error: "Gateway not found" }, { status: 404 });
    }

    await deleteGateway(params.gatewayId);
    return json({ ok: true });
  },
);

export { action, loader };
