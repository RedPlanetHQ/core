import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { callTool } from "~/services/gateway/transport.server";

const Body = z.object({
  name: z.string().min(1),
  profile: z.string().min(1),
});

/**
 * POST /api/v1/gateways/:gatewayId/browser/sessions
 * body: { name, profile }
 *
 * Create a new browser session on the gateway, binding the alias `name` to
 * an existing `profile`. Proxies to the gateway's `browser_create_session`
 * tool.
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

  try {
    await callTool(gatewayId, "browser_create_session", {
      session: parsed.data.name,
      profile: parsed.data.profile,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  return json({ ok: true });
}
