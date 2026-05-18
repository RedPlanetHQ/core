/**
 * Browser-side helpers for resolving the xterm WebSocket URL via the
 * `/xterm-ticket` endpoints. The response is one of:
 *
 *   { mode: "direct", wsUrl: "wss://gw.host/…?ticket=…", expiresAt }
 *   { mode: "proxy",  wsUrl: "/api/v1/…/xterm…" }
 *
 * Direct URLs are already absolute; proxy URLs are relative paths and need
 * the page's host + scheme prepended.
 */

interface TicketResponse {
  mode: "direct" | "proxy";
  wsUrl: string;
  expiresAt?: number;
}

function resolveWsUrl(raw: string): string {
  if (/^wss?:\/\//i.test(raw)) return raw;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Tolerate a leading-slashless path just in case ("api/...").
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${proto}//${window.location.host}${path}`;
}

async function requestTicket(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `xterm-ticket ${res.status}: ${text || res.statusText}`.trim(),
    );
  }
  const data = (await res.json()) as TicketResponse;
  if (typeof data?.wsUrl !== "string" || !data.wsUrl) {
    throw new Error("xterm-ticket: response missing wsUrl");
  }
  return resolveWsUrl(data.wsUrl);
}

/**
 * Resolve a WebSocket URL for an xterm attach to a *gateway-direct* session
 * (per-gateway Terminal tab, agent-login dialog). `sessionId` is the
 * gateway's external session id (the one the PTY is keyed by).
 */
export function requestGatewayXtermWsUrl(
  gatewayId: string,
  sessionId: string,
): Promise<string> {
  return requestTicket(
    `/api/v1/gateways/${encodeURIComponent(gatewayId)}/xterm-ticket`,
    { session_id: sessionId },
  );
}

/**
 * Resolve a WebSocket URL for an xterm attach bound to a CodingSession row.
 * The webapp looks up the row's gateway + externalSessionId server-side.
 */
export function requestCodingSessionXtermWsUrl(
  codingSessionId: string,
): Promise<string> {
  return requestTicket(
    `/api/v1/coding-sessions/${encodeURIComponent(codingSessionId)}/xterm-ticket`,
    {},
  );
}
