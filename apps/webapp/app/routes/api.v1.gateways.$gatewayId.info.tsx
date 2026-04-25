import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { getGatewayInfo } from "~/services/gateway/utils.server";
import { refreshGatewayHealth } from "~/services/gateway/health.server";

/**
 * GET /api/v1/gateways/:gatewayId/info
 *
 * Returns the folders, agents, and tools advertised by the gateway's live
 * manifest. Used by the "New coding session" dialog to show what the user
 * can target on the selected gateway.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const { gatewayId } = params;
  if (!gatewayId) {
    return json({ error: "Missing gatewayId" }, { status: 400 });
  }

  // Verify the gateway belongs to this workspace before we leak manifest data.
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true, name: true, status: true },
  });
  if (!gateway) {
    return json({ error: "Gateway not found" }, { status: 404 });
  }

  // Probe the gateway so the manifest we return is fresh. Short timeout so
  // a dead gateway doesn't stall the dialog.
  await refreshGatewayHealth(gatewayId, 4_000).catch(() => "disconnected");

  const info = await getGatewayInfo(gatewayId);
  if (!info) {
    return json(
      { error: "Gateway is unreachable", gateway },
      { status: 503 },
    );
  }

  return json({
    gateway: { ...gateway, ...info.gateway },
    folders: info.folders,
    agents: info.agents,
    tools: info.tools,
  });
}
