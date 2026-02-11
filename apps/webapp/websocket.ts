import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";

// Types for gateway protocol
interface GatewayTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface GatewayInitMessage {
  type: "init";
  name: string;
  description?: string;
  clientVersion?: string;
  platform?: string;
  hostname?: string;
}

interface GatewaySupportedToolsMessage {
  type: "supported_tools";
  tools: GatewayTool[];
}

interface GatewayToolResultMessage {
  type: "tool_result";
  id: string;
  result?: unknown;
  error?: string;
}

type GatewayClientMessage =
  | GatewayInitMessage
  | GatewaySupportedToolsMessage
  | GatewayToolResultMessage;

interface GatewayConnection {
  ws: WebSocket;
  gatewayId: string | null;
  workspaceId: string;
  userId: string;
  name: string | null;
  state: "connecting" | "awaiting_tools" | "ready";
  pendingToolCalls: Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
}

// In-memory connection store
const connections = new Map<string, GatewayConnection>();

// Module reference for auth
let moduleRef: any = null;

export function setupWebSocket(server: Server, module: any) {
  moduleRef = module;

  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Only handle /gateway/ws path
    if (url.pathname !== "/gateway/ws") {
      socket.destroy();
      return;
    }

    // Auth via token query param
    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const auth = await moduleRef.verifyGatewayToken(token);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, auth);
      });
    } catch (err) {
      console.error("Gateway auth error:", err);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  // Handle connections
  wss.on(
    "connection",
    (
      ws: WebSocket,
      _req: any,
      auth: { workspaceId: string; userId: string },
    ) => {
      const connectionId = crypto.randomUUID();

      const connection: GatewayConnection = {
        ws,
        gatewayId: null,
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        name: null,
        state: "connecting",
        pendingToolCalls: new Map(),
      };

      // Store temporarily by connection ID
      connections.set(connectionId, connection);

      console.log(`Gateway connecting: ${connectionId}`);

      ws.on("message", async (data) => {
        try {
          const message: GatewayClientMessage = JSON.parse(data.toString());
          await handleMessage(connection, message, connectionId);
        } catch (err) {
          console.error("Gateway message error:", err);
          send(ws, {
            type: "error",
            message: err instanceof Error ? err.message : "Invalid message",
            code: "INVALID_MESSAGE",
          });
        }
      });

      ws.on("close", async () => {
        await handleDisconnect(connection, connectionId);
      });

      ws.on("error", async (err) => {
        console.error("Gateway WebSocket error:", err);
        await handleDisconnect(connection, connectionId);
      });
    },
  );

  console.log("WebSocket server initialized for /gateway/ws");
}

function send(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function handleMessage(
  connection: GatewayConnection,
  message: GatewayClientMessage,
  connectionId: string,
): Promise<void> {
  switch (message.type) {
    case "init": {
      if (connection.state !== "connecting") {
        send(connection.ws, {
          type: "error",
          message: "Already initialized",
          code: "ALREADY_INITIALIZED",
        });
        return;
      }

      // Upsert gateway in database
      const gateway = await moduleRef.upsertGateway({
        workspaceId: connection.workspaceId,
        userId: connection.userId,
        name: message.name,
        description: message.description,
        clientVersion: message.clientVersion,
        platform: message.platform,
        hostname: message.hostname,
      });

      connection.gatewayId = gateway.id;
      connection.name = message.name;
      connection.state = "awaiting_tools";

      // Move from temp connectionId to gateway ID
      connections.delete(connectionId);
      connections.set(gateway.id, connection);

      console.log(`Gateway initialized: ${message.name} (${gateway.id})`);

      // Request supported tools
      send(connection.ws, { type: "get_supported_tools" });
      break;
    }

    case "supported_tools": {
      if (connection.state !== "awaiting_tools" || !connection.gatewayId) {
        send(connection.ws, {
          type: "error",
          message: "Invalid state",
          code: "INVALID_STATE",
        });
        return;
      }

      // Store tools in database
      await moduleRef.updateGatewayTools(connection.gatewayId, message.tools);

      connection.state = "ready";

      console.log(
        `Gateway ready: ${connection.name} with ${message.tools.length} tools`,
      );

      // Send ready confirmation
      send(connection.ws, {
        type: "ready",
        gatewayId: connection.gatewayId,
      });
      break;
    }

    case "tool_result": {
      const pending = connection.pendingToolCalls.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
        connection.pendingToolCalls.delete(message.id);
      }

      // Update last seen
      if (connection.gatewayId) {
        await moduleRef.updateGatewayLastSeen(connection.gatewayId);
      }
      break;
    }
  }
}

async function handleDisconnect(
  connection: GatewayConnection,
  connectionId: string,
): Promise<void> {
  // Clean up pending tool calls
  for (const [, pending] of connection.pendingToolCalls) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Gateway disconnected"));
  }
  connection.pendingToolCalls.clear();

  // Remove from connections
  if (connection.gatewayId) {
    connections.delete(connection.gatewayId);
    await moduleRef.disconnectGateway(connection.gatewayId);
    console.log(
      `Gateway disconnected: ${connection.name} (${connection.gatewayId})`,
    );
  } else {
    connections.delete(connectionId);
    console.log(`Gateway connection closed: ${connectionId}`);
  }
}

// === Public API for calling gateway tools ===

export function getGatewayConnection(
  gatewayId: string,
): GatewayConnection | undefined {
  return connections.get(gatewayId);
}

export function getWorkspaceGateways(workspaceId: string): string[] {
  return Array.from(connections.entries())
    .filter(
      ([, conn]) => conn.workspaceId === workspaceId && conn.state === "ready",
    )
    .map(([id]) => id);
}

export function isGatewayConnected(gatewayId: string): boolean {
  const conn = connections.get(gatewayId);
  return conn?.state === "ready";
}

export async function callGatewayTool(
  gatewayId: string,
  tool: string,
  params: Record<string, unknown>,
  timeoutMs: number = 30000,
): Promise<unknown> {
  const connection = connections.get(gatewayId);

  if (!connection || connection.state !== "ready") {
    throw new Error("Gateway not connected");
  }

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pendingToolCalls.delete(id);
      reject(new Error("Tool call timeout"));
    }, timeoutMs);

    connection.pendingToolCalls.set(id, { resolve, reject, timer });

    send(connection.ws, {
      type: "tool_call",
      id,
      tool,
      params,
    });
  });
}
