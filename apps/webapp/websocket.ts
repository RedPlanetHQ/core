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
  const xtermWss = new WebSocketServer({ noServer: true });
  const browserCdpWss = new WebSocketServer({ noServer: true });

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
