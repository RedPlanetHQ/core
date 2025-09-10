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
import { Workspace } from "@prisma/client";

const QueryParams = z.object({
  source: z.string().optional(),
  integrations: z.string().optional(), // comma-separated slugs
  no_integrations: z.boolean().optional(), // comma-separated slugs
});

// Create MCP server with memory tools + dynamic integration tools
async function createMcpServer(
  userId: string,
  sessionId: string,
  source: string,
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

  // Dynamic tool listing that includes integration tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get integration tools
    let integrationTools: any[] = [];
    try {
      integrationTools =
        await IntegrationLoader.getAllIntegrationTools(sessionId);
    } catch (error) {
      logger.error(`Error loading integration tools: ${error}`);
    }

    return {
      tools: [...memoryTools, ...integrationTools],
    };
  });

  // Handle tool calls for both memory and integration tools
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle memory tools
    if (name.startsWith("memory_") || name.startsWith("get_user_profile")) {
      return await callMemoryTool(name, args, userId, source);
    }

    // Handle integration tools (prefixed with integration slug)
    if (name.includes("_") && !name.startsWith("memory_")) {
      try {
        return await IntegrationLoader.callIntegrationTool(
          sessionId,
          name,
          args,
        );
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calling integration tool: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
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
  const server = await createMcpServer(userId, sessionId, source);
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

  const userId = authentication.userId;
  const workspace = await getWorkspaceByUser(userId);
  const workspaceId = workspace?.id as string;

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
    const sessionData = TransportManager.getSessionInfo(sessionId);

    if (sessionData.exists) {
      const transport =
        sessionData.mainTransport as StreamableHTTPServerTransport;

      await transport.handleRequest(req, res);
    } else {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
  } else {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
};
