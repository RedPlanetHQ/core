import { prisma } from "~/db.server";
import { fetchHealth, fetchManifest } from "./transport.server";
import { markConnected, markDisconnected } from "./crud.server";

/**
 * Live health probe for a single gateway. Pings `/healthz`, and on success
 * pulls the manifest once to refresh the lightweight client metadata columns
 * (version/platform/hostname). The full manifest is not persisted — agent and
 * UI code live-fetch it on demand.
 *
 * Designed to be called from user-facing loaders — keep the timeout short so
 * a dead gateway doesn't stall page rendering.
 */
export async function refreshGatewayHealth(
  gatewayId: string,
  timeoutMs = 4_000,
): Promise<"connected" | "disconnected"> {
  const health = await fetchHealth(gatewayId, timeoutMs);
  if (!health) {
    await markDisconnected(gatewayId, "health check failed");
    return "disconnected";
  }

  const m = await fetchManifest(gatewayId, timeoutMs);
  await markConnected(
    gatewayId,
    m
      ? {
          clientVersion: m.manifest.gateway.version,
          platform: m.manifest.gateway.platform,
          hostname: m.manifest.gateway.hostname,
        }
      : {},
  );
  return "connected";
}

/**
 * Refresh every gateway in a workspace concurrently. Used by the settings
 * page loader to show fresh heartbeat info on each visit.
 */
export async function refreshWorkspaceGateways(
  workspaceId: string,
  timeoutMs = 4_000,
): Promise<void> {
  const rows = await prisma.gateway.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  await Promise.all(
    rows.map((g) =>
      refreshGatewayHealth(g.id, timeoutMs).catch(() => "disconnected"),
    ),
  );
}
