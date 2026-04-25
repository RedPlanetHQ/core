import type { IncomingMessage } from "http";
import type { Socket } from "net";
import WebSocket, { WebSocketServer } from "ws";
import { prisma } from "~/db.server";
import { sessionStorage } from "~/services/sessionStorage.server";
import { readSecurityKey } from "./secrets.server";

/**
 * WebSocket upgrade proxy: browser → webapp → gateway xterm PTY.
 *
 * Browser connects to:
 *   ws(s)://app.getcore.me/api/v1/coding-sessions/<codingSessionId>/xterm
 * The webapp authenticates via the session cookie, looks up the gateway +
 * externalSessionId for that coding session, decrypts the gateway's
 * securityKey, and opens an upstream WS to:
 *   ws(s)://<gw.baseUrl>/api/coding/coding_xterm_session?session_id=<externalSessionId>
 * then pipes frames in both directions.
 *
 * This keeps the securityKey out of the browser (browser only has a session
 * cookie) and mirrors the Fastify-side xterm WS envelope — input/resize
 * JSON messages pass through unchanged.
 */

const pathMatcher =
  /^\/api\/v1\/coding-sessions\/([^/]+)\/xterm\/?$/;

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

async function resolveSession(
  codingSessionId: string,
  userId: string,
): Promise<
  | {
      externalSessionId: string;
      baseUrl: string;
      gatewayId: string;
    }
  | { error: string; code: number }
> {
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
    externalSessionId: session.externalSessionId,
    baseUrl: session.gateway.baseUrl,
    gatewayId: session.gateway.id,
  };
}

function pipeFrames(client: WebSocket, upstream: WebSocket): void {
  const closeBoth = (code = 1000, reason = "") => {
    if (client.readyState === client.OPEN) client.close(code, reason);
    if (upstream.readyState === upstream.OPEN) upstream.close(code, reason);
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

async function handleUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  wss: WebSocketServer,
  codingSessionId: string,
): Promise<void> {
  const auth = await authenticate(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const resolved = await resolveSession(codingSessionId, auth.userId);
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
    `/api/coding/coding_xterm_session?session_id=${encodeURIComponent(
      resolved.externalSessionId,
    )}`;
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
  const match = pathMatcher.exec(url.pathname);
  if (!match) return false;
  handleUpgrade(req, socket, head, wss, match[1]!).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("xterm proxy upgrade failed", err);
    try {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    } catch {
      /* already closed */
    }
  });
  return true;
}
