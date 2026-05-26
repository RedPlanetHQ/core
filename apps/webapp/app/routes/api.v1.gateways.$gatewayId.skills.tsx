import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { gatewayApi } from "~/services/gateway/transport.server";

/**
 * POST /api/v1/gateways/:gatewayId/skills
 *
 * Proxies skill install requests to the gateway daemon.
 *
 *   body: { source: "url", url, skill?, force? }
 *   body: { source: "files", name, files, force? }
 */
const Body = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("url"),
    url: z.string().min(1),
    skill: z.string().optional(),
    force: z.boolean().optional(),
  }),
  z.object({
    source: z.literal("files"),
    name: z.string().min(1),
    files: z.record(z.string(), z.string()),
    force: z.boolean().optional(),
  }),
]);

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
    skill?: unknown;
    error?: string;
  }>(gatewayId, "/api/skills/install", {
    method: "POST",
    body: JSON.stringify(parsed.data),
    timeoutMs: 5 * 60_000,
  });
  if (status >= 400 || !body.ok) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ skill: body.skill }, { status: 201 });
}
