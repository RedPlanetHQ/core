import type { IncomingMessage } from "http";
import type { Socket } from "net";
import WebSocket, { WebSocketServer } from "ws";
import { prisma } from "~/db.server";
import { sessionStorage } from "~/services/sessionStorage.server";
import { readSecurityKey } from "./secrets.server";

/**
 * WebSocket proxy that pipes Chrome DevTools Protocol traffic from the
 * browser → webapp → gateway → local Chromium.
 *
 * Path:
 *   ws(s)://app/.../api/v1/gateways/<gatewayId>/browser/cdp/<sessionName>
 *
 * The webapp authenticates via the session cookie, decrypts the gateway's
 * security key, opens an upstream WS to:
 *   ws(s)://<gateway>/api/browser/cdp/<sessionName>
 * and pipes raw frames in both directions. CDP messages are short JSON
 * text frames — no transformation needed.
 *
 * Used by the per-task Browser tab to render a live screencast and forward
 * `Input.*` events for "take control".
 */

const browserCdpPath =
  /^\/api\/v1\/gateways\/([^/]+)\/browser\/cdp\/([^/]+)\/?$/;

async function authenticate(
  req: IncomingMessage,
): Promise<{ userId: string } | null> {
  const cookieHeader = req.headers.cookie ?? null;
  const session = await sessionStorage.getSession(cookieHeader);
  const user = session.get("user") as { userId: string } | undefined;
  if (!user?.userId) return null;
  return { userId: user.userId };
}

async function resolveTarget(
  gatewayId: string,
  sessionName: string,
  userId: string,
): Promise<
  | { baseUrl: string; gatewayId: string; sessionName: string }
  | { error: string; code: number }
> {
  if (!sessionName) {
    return { error: "session is required", code: 400 };
  }
  const gateway = await prisma.gateway.findFirst({
    where: {
      id: gatewayId,
      workspace: { UserWorkspace: { some: { userId } } },
    },
    select: { id: true, baseUrl: true },
  });
  if (!gateway) return { error: "gateway not found", code: 404 };
  return { baseUrl: gateway.baseUrl, gatewayId: gateway.id, sessionName };
}

function pipeFrames(client: WebSocket, upstream: WebSocket): void {
  const closeBoth = (code = 1000, reason = "") => {
    if (client.readyState === client.OPEN) client.close(code, reason);
    if (upstream.readyState === upstream.OPEN) upstream.close(code, reason);
  };

  // CDP frames are JSON text — `ws` emits them as Buffer by default, and
  // `send(buffer)` re-emits them as a binary frame, which Chromium rejects
  // ("Connection: close" on protocol mismatch). Normalize to UTF-8 strings
  // so both hops always send text frames.
  const toText = (data: unknown): string => {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (Array.isArray(data))
      return Buffer.concat(data as Buffer[]).toString("utf8");
    if (data instanceof ArrayBuffer)
      return Buffer.from(data).toString("utf8");
    return String(data);
  };

  let cToU = 0;
  let uToC = 0;
  const previewFrame = (frame: string): string => {
    try {
      const parsed = JSON.parse(frame);
      return parsed.method ?? `id=${parsed.id ?? "?"}`;
    } catch {
      return frame.slice(0, 60);
    }
  };

  client.on("message", (data) => {
    const frame = toText(data);
    cToU += 1;
    if (cToU <= 3) {
      // eslint-disable-next-line no-console
      console.log(
        `[cdp-proxy] browser→gateway [${cToU}]: ${previewFrame(frame)}`,
      );
    }
    if (upstream.readyState === upstream.OPEN) upstream.send(frame);
  });
  upstream.on("message", (data) => {
    const frame = toText(data);
    uToC += 1;
    if (uToC <= 3) {
      // eslint-disable-next-line no-console
      console.log(
        `[cdp-proxy] gateway→browser [${uToC}]: ${previewFrame(frame)} clientReady=${client.readyState === client.OPEN}`,
      );
    }
    if (client.readyState === client.OPEN) client.send(frame);
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
  gatewayId: string,
  sessionName: string,
): Promise<void> {
  const auth = await authenticate(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const resolved = await resolveTarget(gatewayId, sessionName, auth.userId);
  if ("error" in resolved) {
    socket.write(`HTTP/1.1 ${resolved.code} ${resolved.error}\r\n\r\n`);
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
    `/api/browser/cdp/${encodeURIComponent(resolved.sessionName)}`;
  const upstream = new WebSocket(upstreamUrl, {
    headers: { authorization: `Bearer ${securityKey}` },
    perMessageDeflate: false,
  });

  upstream.once("open", () => {
    wss.handleUpgrade(req, socket, head, (client) => {
      pipeFrames(client, upstream);
    });
  });

  upstream.once("error", (err) => {
    socket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n${err.message ?? ""}`);
    socket.destroy();
  });
}

/**
 * Wire the browser-CDP proxy into the shared `server.on('upgrade')` handler.
 * Returns true if the request matched and was handled.
 */
export function tryHandleBrowserCdpUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  wss: WebSocketServer,
): boolean {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const match = browserCdpPath.exec(url.pathname);
  if (!match) return false;

  const gatewayId = match[1]!;
  const sessionName = decodeURIComponent(match[2]!);
  handleUpgrade(req, socket, head, wss, gatewayId, sessionName).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("browser-cdp proxy upgrade failed", err);
    try {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    } catch {
      /* already closed */
    }
  });
  return true;
}
