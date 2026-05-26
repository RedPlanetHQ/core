import { json, type ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { gatewayApi } from "~/services/gateway/transport.server";

/**
 * DELETE /api/v1/gateways/:gatewayId/skills/:skillName
 * Removes the skill directory on the gateway.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { gatewayId, skillName } = params;
  if (!gatewayId || !skillName) {
    return json({ error: "Missing param" }, { status: 400 });
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

  const { status, body } = await gatewayApi<{ ok: boolean; error?: string }>(
    gatewayId,
    `/api/skills/${encodeURIComponent(skillName)}`,
    { method: "DELETE" },
  );
  if (status >= 400 || !body.ok) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ ok: true });
}
