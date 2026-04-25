import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { gatewayApi } from "~/services/gateway/transport.server";

const Body = z.object({
  sessionName: z.string().min(1),
});

/**
 * POST /api/v1/gateways/:gatewayId/browser/launch
 * body: { sessionName }
 *
 * Lazy-launches the named browser session on the gateway in **headless**
 * mode — the gateway settings UI shows the live state via CDP screencast,
 * so a visible window isn't needed. Idempotent — subsequent calls just
 * reattach.
 */
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
    error?: string;
    session?: { name: string; profile: string; cdpReady: boolean };
  }>(gatewayId, "/api/browser/launch", {
    method: "POST",
    body: JSON.stringify({ session: parsed.data.sessionName }),
    timeoutMs: 30_000,
  });
  if (status >= 400 || !body.ok) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ session: body.session });
}
