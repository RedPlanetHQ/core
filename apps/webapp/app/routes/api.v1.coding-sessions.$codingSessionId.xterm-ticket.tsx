import { json, type ActionFunctionArgs } from "@remix-run/node";
import { createHash, createHmac } from "node:crypto";
import { prisma } from "~/db.server";
import { requireUser } from "~/services/session.server";
import { readSecurityKey } from "~/services/gateway/secrets.server";
import { fetchManifest } from "~/services/gateway/transport.server";

/**
 * POST /api/v1/coding-sessions/:codingSessionId/xterm-ticket
 *
 * CodingSession-bound twin of /api/v1/gateways/:gatewayId/xterm-ticket: the
 * caller (the per-task coding UI) only knows the CodingSession.id; this
 * endpoint resolves it to (gateway, externalSessionId), then either signs a
 * direct-attach ticket or returns the existing webapp proxy URL.
 *
 * See the gateway-variant route for the ticket format and rationale.
 */

const TICKET_TTL_MS = 5 * 60 * 1000;

interface ManifestCapabilities {
  directXterm?: boolean;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const { codingSessionId } = params;
  if (!codingSessionId) {
    return json({ error: "Missing codingSessionId" }, { status: 400 });
  }

  const user = await requireUser(request);

  // Workspace membership check via the CodingSession relation — mirrors the
  // resolveSession() logic in xterm-proxy.server.ts so a tenant can't issue
  // tickets for a gateway they don't own.
  const cs = await prisma.codingSession.findFirst({
    where: {
      id: codingSessionId,
      workspace: { UserWorkspace: { some: { userId: user.id } } },
    },
    select: {
      externalSessionId: true,
      gateway: { select: { id: true, baseUrl: true } },
    },
  });
  if (!cs) return json({ error: "Not found" }, { status: 404 });
  if (!cs.externalSessionId) {
    return json({ error: "Session has no externalSessionId" }, { status: 422 });
  }
  if (!cs.gateway?.baseUrl) {
    return json({ error: "No gateway linked" }, { status: 422 });
  }
  const externalSessionId = cs.externalSessionId;
  const gw = cs.gateway;

  const fetched = await fetchManifest(gw.id, 5_000);
  const caps = fetched?.manifest.capabilities as
    | ManifestCapabilities
    | undefined;
  const supportsDirect = caps?.directXterm === true;
  // Full `https://` prefix — `/^https:/i` would also match `https:foo`.
  const baseUrlIsHttps = /^https:\/\//i.test(gw.baseUrl);

  const proxyResponse = json({
    mode: "proxy" as const,
    wsUrl: `/api/v1/coding-sessions/${encodeURIComponent(codingSessionId)}/xterm`,
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
    JSON.stringify({ sid: externalSessionId, exp }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", hmacKey).update(payload).digest("base64url");
  const ticket = `${payload}.${sig}`;

  const wsBase = gw.baseUrl.replace(/^http/i, "ws").replace(/\/$/, "");
  const wsUrl = `${wsBase}/api/coding/coding_xterm_session?session_id=${encodeURIComponent(
    externalSessionId,
  )}&ticket=${encodeURIComponent(ticket)}`;

  return json({ mode: "direct" as const, wsUrl, expiresAt: exp });
}
