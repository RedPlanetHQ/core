import { type Server } from "http";
import { WebSocketServer } from "ws";
import { hocuspocus } from "~/services/hocuspocus/content.server";
import { tryHandleXtermUpgrade } from "~/services/gateway/xterm-proxy.server";
import { tryHandleBrowserCdpUpgrade } from "~/services/gateway/browser-cdp-proxy.server";

/**
 * Attach WebSocket upgrade handlers to the HTTP server.
 *
 * Paths handled:
 *   /collab/*                                              → Hocuspocus collab
 *   /api/v1/coding-sessions/:id/xterm                      → xterm proxy
 *   /api/v1/gateways/:id/xterm                             → xterm gateway-direct
 *   /api/v1/gateways/:id/browser/cdp/:sessionName          → browser CDP proxy
 */
export function setupWebSocket(server: Server): void {
  const collabWss = new WebSocketServer({ noServer: true });
  // permessage-deflate batches small frames before compressing, adding
  // perceptible latency to per-keystroke terminal traffic. The upstream
  // legs (xterm-proxy → gateway, browser-cdp-proxy → gateway) already
  // disable it; mirror that on the browser-facing legs so neither hop
  // negotiates deflate. Terminal/CDP frames are tiny and mostly ASCII —
  // the bandwidth cost is negligible vs. snappier typing.
  const xtermWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const browserCdpWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/collab")) {
      collabWss.handleUpgrade(req, socket, head, (ws) => {
        hocuspocus.handleConnection(ws, req);
      });
      return;
    }

    if (tryHandleBrowserCdpUpgrade(req, socket, head, browserCdpWss)) {
      return;
    }

    if (tryHandleXtermUpgrade(req, socket, head, xtermWss)) {
      return;
    }

    socket.destroy();
  });
}
