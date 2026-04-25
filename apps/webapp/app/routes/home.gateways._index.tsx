import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/services/session.server";
import { listGateways } from "~/services/gateway.server";

/**
 * /home/gateways → redirect to the first gateway, or to settings if there
 * are none. We always land in a per-gateway view since that's where the UI
 * lives; if you want the "no gateways yet" empty state, the sidebar's
 * Gateways section + the Register dialog handle it.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);
  if (!workspaceId) throw new Error("Workspace not found");
  const gateways = await listGateways(workspaceId);
  if (gateways.length === 0) {
    return redirect("/home");
  }
  return redirect(`/home/gateways/${gateways[0].id}/info`);
}

export default function GatewaysIndex() {
  return null;
}
