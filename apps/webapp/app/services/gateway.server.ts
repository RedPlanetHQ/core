import { prisma } from "~/db.server";
import { authenticateApiKeyWithFailure } from "./apiAuth.server";

// === Token verification ===

export async function verifyGatewayToken(token: string) {
  const authentication = await authenticateApiKeyWithFailure(token, {});

  if (!authentication.ok) {
    return false;
  }

  if (authentication.ok && authentication.userId) {
    return authentication;
  }

  return false;
}

// === Gateway CRUD operations ===

interface UpsertGatewayParams {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  description?: string;
  clientVersion?: string;
  platform?: string;
  hostname?: string;
}

export async function upsertGateway(params: UpsertGatewayParams) {
  return prisma.gateway.upsert({
    where: {
      id: params.id,
      workspaceId: params.workspaceId,
    },
    create: {
      id: params.id,
      name: params.name,
      description: params.description,
      workspaceId: params.workspaceId,
      userId: params.userId,
      status: "CONNECTED",
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      clientVersion: params.clientVersion,
      platform: params.platform,
      hostname: params.hostname,
    },
    update: {
      description: params.description,
      status: "CONNECTED",
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      clientVersion: params.clientVersion,
      platform: params.platform,
      hostname: params.hostname,
      name: params.name,
    },
  });
}

export async function updateGatewayTools(gatewayId: string, tools: unknown[]) {
  return prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      tools: tools as any,
      lastSeenAt: new Date(),
    },
  });
}

export async function updateGatewayLastSeen(gatewayId: string) {
  return prisma.gateway.update({
    where: { id: gatewayId },
    data: { lastSeenAt: new Date() },
  });
}

export async function disconnectGateway(gatewayId: string) {
  return prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: new Date(),
    },
  });
}

// === Query functions ===

export async function getGateway(gatewayId: string) {
  return prisma.gateway.findUnique({
    where: { id: gatewayId },
  });
}

export async function listGateways(workspaceId: string) {
  return prisma.gateway.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getConnectedGateways(workspaceId: string) {
  return prisma.gateway.findMany({
    where: {
      workspaceId,
      status: "CONNECTED",
    },
    orderBy: { connectedAt: "desc" },
  });
}
