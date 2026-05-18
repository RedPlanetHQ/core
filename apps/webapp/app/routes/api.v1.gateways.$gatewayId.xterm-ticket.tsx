import { json, type ActionFunctionArgs } from "@remix-run/node";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import { readSecurityKey } from "~/services/gateway/secrets.server";
import { fetchManifest } from "~/services/gateway/transport.server";

/**
 * POST /api/v1/gateways/:gatewayId/xterm-ticket
 * body: { session_id }
 *
 * Returns a WebSocket URL the browser should connect to in order to attach
 * to the gateway's xterm PTY for `session_id`.
 *
 *   { mode: "direct", wsUrl: "wss://<gw.baseUrl>/…?ticket=…", expiresAt }
 *   { mode: "proxy",  wsUrl: "/api/v1/gateways/<id>/xterm?session_id=…" }
 *
 * Direct mode is offered only when the gateway advertises
 * `capabilities.directXterm` in its manifest (i.e. it's running a CLI
 * version that knows how to verify HMAC tickets). Older gateways and
 * gateways with the coding slot disabled fall back to the proxy path the
 * webapp has always supported — same wire protocol, just one extra hop.
 *
 * The ticket is HMAC-SHA256(sha256(rawSecurityKey), payload) where
 * payload = base64url(JSON({sid, exp})). The gateway holds
 * sha256(rawSecurityKey) on disk (`securityKeyHash`), so both sides arrive
 * at the same MAC key without sharing a separate secret. TTL is 5 minutes
 * — enough time for the browser to actually open the WS but short enough
 * that a leaked URL is uninteresting.
 */

const Body = z.object({
  session_id: z.string().min(1),
});

const TICKET_TTL_MS = 5 * 60 * 1000;

interface ManifestCapabilities {
  directXterm?: boolean;
}

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
    select: { id: true, baseUrl: true },
  });
  if (!gw) return json({ error: "Gateway not found" }, { status: 404 });

  const raw = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.message }, { status: 400 });
  }
  const sessionId = parsed.data.session_id;

  const fetched = await fetchManifest(gw.id, 5_000);
  const caps = fetched?.manifest.capabilities as
    | ManifestCapabilities
    | undefined;
  const supportsDirect = caps?.directXterm === true;

  // Browser can't open `ws://` from an `https://` page (mixed content).
  // If the gateway is plain http, fall back to the proxy even if the
  // gateway itself supports tickets — the webapp's WS endpoint inherits
  // the page's TLS context. Match the full `https://` prefix so a
  // malformed `https:foo` doesn't slip past.
  const baseUrlIsHttps = /^https:\/\//i.test(gw.baseUrl);

  const proxyResponse = json({
    mode: "proxy" as const,
    wsUrl: `/api/v1/gateways/${gw.id}/xterm?session_id=${encodeURIComponent(sessionId)}`,
  });
  if (!supportsDirect || !baseUrlIsHttps) return proxyResponse;

  // If the encrypted key is missing or corrupt we can't sign — fall back
  // to the proxy path instead of 500'ing the terminal open.
  let securityKey: string;
  try {
    securityKey = await readSecurityKey(gw.id);
  } catch {
    return proxyResponse;
  }
  const hmacKey = createHash("sha256").update(securityKey).digest("hex");
  const exp = Date.now() + TICKET_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ sid: sessionId, exp }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", hmacKey).update(payload).digest("base64url");
  const ticket = `${payload}.${sig}`;

  const wsBase = gw.baseUrl.replace(/^http/i, "ws").replace(/\/$/, "");
  const wsUrl = `${wsBase}/api/coding/coding_xterm_session?session_id=${encodeURIComponent(
    sessionId,
  )}&ticket=${encodeURIComponent(ticket)}`;

  return json({ mode: "direct" as const, wsUrl, expiresAt: exp });
}
