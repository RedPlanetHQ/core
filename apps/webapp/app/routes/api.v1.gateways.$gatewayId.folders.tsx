import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { gatewayApi } from "~/services/gateway/transport.server";

/**
 * Per-gateway folder management proxy.
 *
 *   GET  /api/v1/gateways/:gatewayId/folders         → mirrors gateway list
 *   POST /api/v1/gateways/:gatewayId/folders
 *        body: { mode: "local", path, name?, scopes? }
 *        body: { mode: "git",   url,  name?, branch? }
 *
 * Webapp doesn't store any folder state — it just relays to the gateway with
 * the gateway's encrypted security key. Workspace-membership check guards
 * cross-tenant access.
 */
async function authorize(
  request: Request,
  gatewayId: string,
): Promise<{ workspaceId: string } | { error: string; status: number }> {
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
  if (!gw) return { error: "Gateway not found", status: 404 };
  return { workspaceId };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) return json({ error: "Missing gatewayId" }, { status: 400 });
  const auth = await authorize(request, gatewayId);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });

  const { status, body } = await gatewayApi<{
    ok: boolean;
    folders?: unknown[];
    error?: string;
  }>(gatewayId, "/api/folders");
  if (status >= 400 || !body.ok) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ folders: body.folders ?? [] });
}

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("local"),
    path: z.string().min(1),
    name: z.string().optional(),
    scopes: z
      .array(z.enum(["files", "coding", "exec"]))
      .optional(),
  }),
  z.object({
    mode: z.literal("git"),
    url: z.string().url(),
    name: z.string().optional(),
    branch: z.string().optional(),
  }),
]);

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { gatewayId } = params;
  if (!gatewayId) return json({ error: "Missing gatewayId" }, { status: 400 });
  const auth = await authorize(request, gatewayId);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const upstreamPath =
    parsed.data.mode === "local" ? "/api/folders/local" : "/api/folders/git";
  const upstreamBody =
    parsed.data.mode === "local"
      ? {
          path: parsed.data.path,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
        }
      : {
          url: parsed.data.url,
          name: parsed.data.name,
          branch: parsed.data.branch,
        };

  const { status, body } = await gatewayApi<{
    ok: boolean;
    folder?: unknown;
    error?: string;
  }>(gatewayId, upstreamPath, {
    method: "POST",
    body: JSON.stringify(upstreamBody),
    timeoutMs: 5 * 60_000, // git clone can be slow
  });
  if (status >= 400 || !body.ok) {
    return json(
      { error: body.error ?? `Gateway error (${status})` },
      { status: status >= 400 ? status : 502 },
    );
  }
  return json({ folder: body.folder }, { status: 201 });
}
