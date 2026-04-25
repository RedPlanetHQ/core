import { json, type ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { callTool } from "~/services/gateway/transport.server";

/**
 * DELETE /api/v1/gateways/:gatewayId/browser/sessions/:sessionName
 *
 * Remove a session alias from the gateway config. Closes the session if
 * running; profile data on disk is preserved. Proxies to the gateway's
 * `browser_delete_session` tool.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { gatewayId, sessionName } = params;
  if (!gatewayId || !sessionName) {
    return json({ error: "Missing params" }, { status: 400 });
  }

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const gw = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gw) return json({ error: "Gateway not found" }, { status: 404 });

  try {
    await callTool(gatewayId, "browser_delete_session", {
      session: sessionName,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  return json({ ok: true });
}
