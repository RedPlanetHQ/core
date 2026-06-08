import { json, type ActionFunctionArgs } from "@remix-run/node";
import path from "node:path";
import { z } from "zod";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { generateFileToken } from "~/services/gateway/file-signed-url.server";

const Body = z.object({ path: z.string().min(1) });

/**
 * POST /api/v1/gateways/:gatewayId/fs/signed-url
 * body: { path }
 *
 * Issues a short-lived (5 min) signed URL that points at the public
 * `/api/v1/fs/signed/:token` route. Used to hand a fetchable URL to
 * embedded viewers (Microsoft Office Online via react-doc-viewer
 * etc.) that can't carry the session cookie.
 *
 * Auth-gated — only callers in the same workspace as the gateway
 * can mint a token for it.
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

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }

  const { token, expiresAt } = generateFileToken({
    workspaceId,
    gatewayId,
    path: parsed.data.path,
  });

  // Append the basename as a trailing path segment so embedded viewers
  // that infer file type from URL extension (notably Microsoft Office
  // Online) recognise PPTX/DOCX/XLSX. The route ignores this segment —
  // the real (gatewayId, path) lives in the verified token payload.
  const origin = env.APP_ORIGIN.replace(/\/+$/, "");
  const filename = path.basename(parsed.data.path);
  const url = `${origin}/api/v1/fs/signed/${token}/${encodeURIComponent(filename)}`;
  return json({ url, expiresAt });
}
