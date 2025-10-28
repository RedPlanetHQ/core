import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MCPSessionManager } from "~/utils/mcp/session-manager";
import { TransportManager } from "~/utils/mcp/transport-manager";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { callMemoryTool, memoryTools } from "~/utils/mcp/memory";
import { logger } from "~/services/logger.service";
import { type Response, type Request } from "express";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { ensureBillingInitialized } from "./billing.server";

const QueryParams = z.object({
  source: z.string().optional(),
  integrations: z.string().optional(), // comma-separated slugs
  no_integrations: z.boolean().optional(),
  spaceId: z.string().optional(), // space UUID to associate memories with
});

// Create MCP server with memory tools + dynamic integration tools
async function createMcpServer(
  userId: string,
  sessionId: string,
  source: string,
  spaceId?: string,
) {
  const server = new Server(
    {
      name: "core-unified-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Dynamic tool listing - only expose memory tools and meta-tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Only return memory tools (which now includes integration meta-tools)
    // Integration-specific tools are discovered via get_integration_actions
    return {
      tools: memoryTools,
    };
  });

  // Handle tool calls for both memory and integration tools
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle memory tools and integration meta-tools
    if (
      name.startsWith("memory_") ||
      name === "get_session_id" ||
      name === "get_integrations" ||
      name === "get_integration_actions" ||
      name === "execute_integration_action"
    ) {
      // Get workspace for integration tools
      const workspace = await getWorkspaceByUser(userId);
      return await callMemoryTool(
        name,
        { ...args, sessionId, workspaceId: workspace?.id, spaceId },
        userId,
        source,
      );
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

// Common function to create and setup transport
async function createTransport(
  sessionId: string,
  source: string,
  integrations: string[],
  noIntegrations: boolean,
  userId: string,
  workspaceId: string,
  spaceId?: string,
): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    onsessioninitialized: async (sessionId) => {
      // Clean up old sessions (24+ hours) during new session initialization
      try {
        const [dbCleanupCount, memoryCleanupCount] = await Promise.all([
          MCPSessionManager.cleanupOldSessions(workspaceId),
          TransportManager.cleanupOldSessions(),
        ]);
        if (dbCleanupCount > 0 || memoryCleanupCount > 0) {
          logger.log(
            `Cleaned up ${dbCleanupCount} DB sessions and ${memoryCleanupCount} memory sessions`,
          );
        }
      } catch (error) {
        logger.error(`Error during session cleanup: ${error}`);
      }

      // Store session in database
      await MCPSessionManager.upsertSession(
        sessionId,
        workspaceId,
        source,
        integrations,
      );

      // Store main transport
      TransportManager.setMainTransport(sessionId, transport);
    },
  });

  const keepAlive = setInterval(() => {
    try {
      transport.send({ jsonrpc: "2.0", method: "ping" });
    } catch (e) {
      // If sending a ping fails, the connection is likely broken.
      // Log the error and clear the interval to prevent further attempts.
      logger.error("Failed to send keep-alive ping, cleaning up interval." + e);
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 60 seconds

  // Setup cleanup on close
  transport.onclose = async () => {
    clearInterval(keepAlive);
    await MCPSessionManager.deleteSession(sessionId);
    await TransportManager.cleanupSession(sessionId);
  };

  // Load integration transports
  try {
    if (!noIntegrations) {
      const result = await IntegrationLoader.loadIntegrationTransports(
        sessionId,
        userId,
        workspaceId,
        integrations.length > 0 ? integrations : undefined,
      );
      logger.log(
        `Loaded ${result.loaded} integration transports for session ${sessionId}`,
      );
      if (result.failed.length > 0) {
        logger.warn(`Failed to load some integrations: ${result.failed}`);
      }
    }
  } catch (error) {
    logger.error(`Error loading integration transports: ${error}`);
  }

  // Create and connect MCP server
  const server = await createMcpServer(userId, sessionId, source, spaceId);
  await server.connect(transport);

  return transport;
}

export const handleMCPRequest = async (
  request: Request,
  res: Response,
  body: any,
  authentication: any,
  queryParams: z.infer<typeof QueryParams>,
) => {
  const sessionId = request.headers["mcp-session-id"] as string | undefined;
  const source = queryParams.source?.toLowerCase() || "api";
  const integrations = queryParams.integrations
    ? queryParams.integrations.split(",").map((s) => s.trim())
    : [];

  const noIntegrations = queryParams.no_integrations ?? false;
  const spaceId = queryParams.spaceId; // Extract spaceId from query params

  const userId = authentication.userId;
  const workspace = await getWorkspaceByUser(userId);
  const workspaceId = workspace?.id as string;

  await ensureBillingInitialized(workspaceId);

  try {
    let transport: StreamableHTTPServerTransport;
    let currentSessionId = sessionId;

    if (
      sessionId &&
      (await MCPSessionManager.isSessionActive(sessionId, workspaceId))
    ) {
      // Use existing session
      const sessionData = TransportManager.getSessionInfo(sessionId);
      if (!sessionData.exists) {
        // Session exists in DB but not in memory, recreate transport
        logger.log(`Recreating transport for session ${sessionId}`);
        const sessionDetails = await MCPSessionManager.getSession(sessionId);
        if (sessionDetails) {
          transport = await createTransport(
            sessionId,
            sessionDetails.source,
            sessionDetails.integrations,
            noIntegrations,
            userId,
            workspaceId,
            spaceId,
          );
        } else {
          throw new Error("Session not found in database");
        }
      } else {
        transport = sessionData.mainTransport as StreamableHTTPServerTransport;
      }
    } else if (!sessionId && isInitializeRequest(body)) {
      // New initialization request
      currentSessionId = randomUUID();
      transport = await createTransport(
        currentSessionId,
        source,
        integrations,
        noIntegrations,
        userId,
        workspaceId,
        spaceId,
      );
    } else {
      // Invalid request
      throw new Error("No session id");
    }

    // Handle the request through existing transport utility
    return await transport.handleRequest(request, res, body);
  } catch (error) {
    console.error("MCP SSE request error:", error);
    throw new Error("MCP SSE request error");
  }
};

export const handleSessionRequest = async (
  req: Request,
  res: Response,
  userId: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const workspace = await getWorkspaceByUser(userId);

  if (
    sessionId &&
    (await MCPSessionManager.isSessionActive(
      sessionId,
      workspace?.id as string,
    ))
  ) {
    await ensureBillingInitialized(workspace?.id as string);

    const sessionData = TransportManager.getSessionInfo(sessionId);

    if (sessionData.exists) {
      const transport =
        sessionData.mainTransport as StreamableHTTPServerTransport;

      await transport.handleRequest(req, res);
    } else {
      res.status(401).send("Invalid or missing session ID");
      return;
    }
  } else {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
};
