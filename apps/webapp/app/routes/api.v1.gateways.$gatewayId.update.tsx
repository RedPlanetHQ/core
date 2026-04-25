import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { prisma } from "~/db.server";
import { updateGatewayConnection } from "~/services/gateway/crud.server";
import { ciphertext, readSecurityKey } from "~/services/gateway/secrets.server";
import { verifyGateway } from "~/services/gateway/transport.server";
import { refreshGatewayHealth } from "~/services/gateway/health.server";

const ParamsSchema = z.object({
  gatewayId: z.string().min(1),
});

const BodySchema = z
  .object({
    baseUrl: z.string().url().optional(),
    securityKey: z.string().min(10).optional(),
  })
  .refine((b) => b.baseUrl !== undefined || b.securityKey !== undefined, {
    message: "Provide baseUrl, securityKey, or both.",
  });

/**
 * PATCH /api/v1/gateways/:gatewayId/update
 *
 * Updates the gateway's connection details (URL and/or security key). Before
 * persisting, verifies the new combination is reachable and the key matches
 * what the daemon stores — so a bad edit can never strand the row.
 */
const { action, loader } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: BodySchema,
    method: "PATCH",
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, body, authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const gateway = await prisma.gateway.findFirst({
      where: {
        id: params.gatewayId,
        workspaceId: authentication.workspaceId as string,
      },
      select: { id: true, baseUrl: true },
    });
    if (!gateway) {
      return json({ error: "Gateway not found" }, { status: 404 });
    }

    const nextBaseUrl =
      body.baseUrl !== undefined
        ? body.baseUrl.replace(/\/$/, "")
        : gateway.baseUrl;
    const nextSecurityKey =
      body.securityKey ?? (await readSecurityKey(gateway.id));

    const probe = await verifyGateway(nextBaseUrl, nextSecurityKey);
    if (!probe) {
      return json(
        {
          error:
            "Gateway is not reachable with the supplied URL and key. Double-check both and try again.",
        },
        { status: 400 },
      );
    }

    await updateGatewayConnection(gateway.id, {
      baseUrl: body.baseUrl !== undefined ? nextBaseUrl : undefined,
      encryptedSecurityKey:
        body.securityKey !== undefined ? ciphertext(nextSecurityKey) : undefined,
    });

    await refreshGatewayHealth(gateway.id).catch(() => "disconnected");

    return json({ ok: true });
  },
);

export { action, loader };
