import type { IncomingMessage } from "http";
import type { Socket } from "net";
import WebSocket, { WebSocketServer } from "ws";
import { prisma } from "~/db.server";
import { sessionStorage } from "~/services/sessionStorage.server";
import { readSecurityKey } from "./secrets.server";
import { spawnCodingSession } from "./transport.server";

/**
 * WebSocket upgrade proxy: browser → webapp → gateway xterm PTY.
 *
 * Two upstream paths are supported, both pipe to the gateway's
 * `/api/coding/coding_xterm_session?session_id=…` endpoint:
 *
 *   1. CodingSession-bound:
 *        ws(s)://…/api/v1/coding-sessions/<codingSessionId>/xterm
 *      Resolves the session row in the DB to get the gateway +
 *      externalSessionId. Used by the per-task coding UI.
 *
 *   2. Gateway-direct:
 *        ws(s)://…/api/v1/gateways/<gatewayId>/xterm?session_id=<extId>
 *      No DB session — the caller (webapp) tells us which gateway PTY to
 *      attach to. Used for the agent-login modal and the per-gateway
 *      Terminal tab where there's no CodingSession to anchor against.
 *
 * Both flows decrypt the gateway's securityKey server-side and pipe frames
 * unchanged so the browser never sees the secret.
 */

const codingSessionPath =
  /^\/api\/v1\/coding-sessions\/([^/]+)\/xterm\/?$/;
const gatewayDirectPath = /^\/api\/v1\/gateways\/([^/]+)\/xterm\/?$/;

async function authenticate(
  req: IncomingMessage,
): Promise<{ userId: string; workspaceId: string } | null> {
  const cookieHeader = req.headers.cookie ?? null;
  const session = await sessionStorage.getSession(cookieHeader);
  const user = session.get("user") as
    | { userId: string; workspaceId?: string }
    | undefined;
  if (!user?.userId) return null;
  // workspaceId on the cookie may be stale — re-resolve through the
  // CodingSession membership check instead.
  return { userId: user.userId, workspaceId: user.workspaceId ?? "" };
}

/**
 * Common shape returned by every resolver. `upstreamPath` is appended to
 * `baseUrl` (after `http→ws` rewrite + trailing-slash strip) to produce the
 * final upstream WS URL — lets each path supply its own gateway-side route.
 */
interface UpstreamTarget {
  baseUrl: string;
  gatewayId: string;
  upstreamPath: string;
}
type ResolverResult = UpstreamTarget | { error: string; code: number };

async function resolveSession(
  codingSessionId: string,
  userId: string,
): Promise<ResolverResult> {
  const session = await prisma.codingSession.findFirst({
    where: {
      id: codingSessionId,
      workspace: { UserWorkspace: { some: { userId } } },
    },
    select: {
      externalSessionId: true,
      gatewayId: true,
      gateway: { select: { baseUrl: true, id: true } },
    },
  });
  if (!session) return { error: "not found", code: 404 };
  if (!session.externalSessionId)
    return { error: "session has no externalSessionId", code: 422 };
  if (!session.gateway?.baseUrl)
    return { error: "no gateway linked", code: 422 };
  return {
    baseUrl: session.gateway.baseUrl,
    gatewayId: session.gateway.id,
    upstreamPath: `/api/coding/coding_xterm_session?session_id=${encodeURIComponent(
      session.externalSessionId,
    )}`,
  };
}

function pipeFrames(client: WebSocket, upstream: WebSocket): void {
  // 1005/1006/1015 etc. are reserved "received-only" close codes — passing
  // them to ws.close() throws (uncaught → process restart). Forward only
  // sendable codes; fall back to 1000.
  const sanitizeCode = (code: number): number =>
    code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;

  const closeBoth = (code = 1000, reason = "") => {
    const safe = sanitizeCode(code);
    try {
      if (client.readyState === client.OPEN) client.close(safe, reason);
    } catch {
      /* already closing */
    }
    try {
      if (upstream.readyState === upstream.OPEN) upstream.close(safe, reason);
    } catch {
      /* already closing */
    }
  };

  client.on("message", (data) => {
    if (upstream.readyState === upstream.OPEN) upstream.send(data as any);
  });
  upstream.on("message", (data) => {
    if (client.readyState === client.OPEN) client.send(data as any);
  });

  client.on("close", (code, reason) => closeBoth(code, reason?.toString()));
  upstream.on("close", (code, reason) => closeBoth(code, reason?.toString()));
  client.on("error", () => closeBoth(1011, "client error"));
  upstream.on("error", () => closeBoth(1011, "upstream error"));
}

async function resolveGatewayDirect(
  gatewayId: string,
  externalSessionId: string,
  userId: string,
): Promise<ResolverResult> {
  if (!externalSessionId) {
    return {error: "session_id query param required", code: 400};
  }
  const gateway = await prisma.gateway.findFirst({
    where: {
      id: gatewayId,
      workspace: {UserWorkspace: {some: {userId}}},
    },
    select: {id: true, baseUrl: true},
  });
  if (!gateway) return {error: "gateway not found", code: 404};
  return {
    baseUrl: gateway.baseUrl,
    gatewayId: gateway.id,
    upstreamPath: `/api/coding/coding_xterm_session?session_id=${encodeURIComponent(
      externalSessionId,
    )}`,
  };
}

async function handleUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  wss: WebSocketServer,
  resolver: (userId: string) => Promise<ResolverResult>,
): Promise<void> {
  const auth = await authenticate(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const resolved = await resolver(auth.userId);
  if ("error" in resolved) {
    socket.write(
      `HTTP/1.1 ${resolved.code} ${resolved.error}\r\n\r\n`,
    );
    socket.destroy();
    return;
  }

  let securityKey: string;
  try {
    securityKey = await readSecurityKey(resolved.gatewayId);
  } catch {
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
    return;
  }

  const upstreamUrl =
    resolved.baseUrl.replace(/^http/i, "ws").replace(/\/$/, "") +
    resolved.upstreamPath;
  const upstream = new WebSocket(upstreamUrl, {
    headers: { authorization: `Bearer ${securityKey}` },
  });

  upstream.once("open", () => {
    wss.handleUpgrade(req, socket, head, (client) => {
      pipeFrames(client, upstream);
    });
  });

  upstream.once("error", (err) => {
    socket.write(
      `HTTP/1.1 502 Bad Gateway\r\n\r\n${err.message ?? ""}`,
    );
    socket.destroy();
  });
}

/**
 * Wire the xterm proxy into the shared `server.on('upgrade')` handler.
 * Returns true if the request path matched and was handled (upgrade consumed),
 * false if the caller should try other matchers.
 */
export function tryHandleXtermUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  wss: WebSocketServer,
): boolean {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  const codingMatch = codingSessionPath.exec(url.pathname);
  if (codingMatch) {
    const codingSessionId = codingMatch[1]!;
    handleUpgrade(req, socket, head, wss, (userId) =>
      resolveSession(codingSessionId, userId),
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("xterm proxy upgrade failed (coding)", err);
      try {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      } catch {
        /* already closed */
      }
    });
    return true;
  }

  const gatewayMatch = gatewayDirectPath.exec(url.pathname);
  if (gatewayMatch) {
    const gatewayId = gatewayMatch[1]!;
    const externalSessionId = url.searchParams.get("session_id") ?? "";
    handleUpgrade(req, socket, head, wss, (userId) =>
      resolveGatewayDirect(gatewayId, externalSessionId, userId),
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("xterm proxy upgrade failed (gateway)", err);
      try {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      } catch {
        /* already closed */
      }
    });
    return true;
  }

  return false;
}
