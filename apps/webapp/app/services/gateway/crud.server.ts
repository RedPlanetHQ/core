import { prisma } from "~/db.server";

/**
 * Read one gateway by ID.
 */
export async function getGateway(gatewayId: string) {
  return prisma.gateway.findUnique({
    where: { id: gatewayId },
  });
}

/**
 * List all gateways in a workspace (regardless of status).
 */
export async function listGateways(workspaceId: string) {
  return prisma.gateway.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * List only CONNECTED gateways in a workspace — the set the agent layer
 * should consider for tool dispatch. Status is kept fresh by the health
 * poller (see gateway/health.server.ts).
 */
export async function getConnectedGateways(workspaceId: string) {
  return prisma.gateway.findMany({
    where: {
      workspaceId,
      status: "CONNECTED",
    },
    orderBy: { connectedAt: "desc" },
  });
}

/**
 * Update status after a successful health poll.
 */
export async function markConnected(
  gatewayId: string,
  patch: {
    clientVersion?: string | null;
    platform?: string | null;
    hostname?: string | null;
  } = {},
) {
  return prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      status: "CONNECTED",
      lastSeenAt: new Date(),
      connectedAt: new Date(),
      lastHealthError: null,
      ...(patch.clientVersion !== undefined ? { clientVersion: patch.clientVersion } : {}),
      ...(patch.platform !== undefined ? { platform: patch.platform } : {}),
      ...(patch.hostname !== undefined ? { hostname: patch.hostname } : {}),
    },
  });
}

/**
 * Mark a gateway as disconnected (health poller noticed it's unreachable).
 */
export async function markDisconnected(gatewayId: string, reason?: string) {
  return prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: new Date(),
      lastHealthError: reason ?? "unreachable",
    },
  });
}

/**
 * Remove a gateway. Cascades to CodingSession rows via the schema relation.
 */
export async function deleteGateway(gatewayId: string) {
  return prisma.gateway.delete({ where: { id: gatewayId } });
}
