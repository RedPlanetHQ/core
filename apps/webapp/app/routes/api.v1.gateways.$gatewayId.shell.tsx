import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { gatewayApi } from "~/services/gateway/transport.server";

/**
 * POST /api/v1/gateways/:gatewayId/shell
 * body: { cwd?, fresh? }
 * → { sessionId, resumed } — browser attaches to the gateway-direct xterm
 *   WS with this id to drive an interactive shell on the gateway host. Used
 *   by the per-gateway Terminal tab. `resumed: true` means the gateway
 *   handed back its existing shell session (scrollback will replay on
 *   attach); `fresh: true` forces a new session.
 */
const Body = z.object({
  cwd: z.string().optional(),
  fresh: z.boolean().optional(),
});

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { gatewayId } = params;
  if (!gatewayId) return json({ error: "Missing gatewayId" }, { status: 400 });

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

  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const { status, body } = await gatewayApi<{
    ok: boolean;
    sessionId?: string;
    resumed?: boolean;
    error?: string;
  }>(gatewayId, "/api/shell/spawn", {
    method: "POST",
    body: JSON.stringify({
      cwd: parsed.data.cwd,
      fresh: parsed.data.fresh,
    }),
  });
  if (status >= 400 || !body.ok || !body.sessionId) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ sessionId: body.sessionId, resumed: body.resumed ?? false });
}
