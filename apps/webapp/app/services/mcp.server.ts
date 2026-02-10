import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MCPSessionManager } from "~/utils/mcp/session-manager";
import { TransportManager } from "~/utils/mcp/transport-manager";
import { callMemoryTool, memoryTools } from "~/utils/mcp/memory";
import { logger } from "~/services/logger.service";
import { type Response, type Request } from "express";
import { ensureBillingInitialized } from "./billing.server";
import { fetchAndSaveIntegrations } from "~/trigger/utils/mcp";

const QueryParams = z.object({
  source: z.string().optional(),
  integrations: z.string().optional(), // comma-separated slugs
  no_integrations: z.boolean().optional(),
  spaceId: z.string().optional(), // space UUID to associate memories with
  skip_tools: z.string().optional(), // comma-separated tool names to exclude
});

// Create MCP server with memory tools + dynamic integration tools
async function createMcpServer(
  userId: string,
  workspaceId: string,
  sessionId: string,
  source: string,
  spaceId?: string,
  skipTools?: string[],
) {
  const server = new Server(
    {
      name: "core",
      version: "1.0.0",
      description:
        "CORE Memory - Intelligent knowledge graph that remembers conversations, documents, and context across all your tools",
      websiteUrl: "https://getcore.me",
      icons: [{ src: "https://getcore.me/logo.png" }],
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    },
  );

  // Dynamic tool listing - only expose memory tools and meta-tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Only return memory tools (which now includes integration meta-tools)
    // Integration-specific tools are discovered via get_integration_actions
    let tools = memoryTools;

    // Filter out skipped tools if specified
    if (skipTools && skipTools.length > 0) {
      tools = tools.filter((tool) => !skipTools.includes(tool.name));
    }

    return {
      tools,
    };
  });

  // Handle tool calls for both memory and integration tools
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle memory tools and integration meta-tools
    if (
      name.startsWith("memory_") ||
      name === "initialize_conversation_session" ||
      name === "get_integrations" ||
      name === "get_integration_actions" ||
      name === "execute_integration_action" ||
      name === "get_labels"
    ) {
      // Get workspace for integration tools
      return await callMemoryTool(
        name,
        {
          // Only use MCP sessionId if not provided in args
          sessionId: args?.sessionId ?? sessionId,
          workspaceId,
          spaceId,
          ...args,
        },
        userId,
        source,
      );
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  // Prompts handler
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "search-context",
          description: "Search your memory for relevant context about a topic",
          arguments: [
            {
              name: "query",
              description:
                "What are you looking for? (e.g., 'authentication bugs', 'API design decisions')",
              required: true,
            },
          ],
        },
        {
          name: "remember-conversation",
          description: "Store this conversation in memory for future reference",
          arguments: [
            {
              name: "summary",
              description: "Brief summary of what was discussed and decided",
              required: true,
            },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "search-context") {
      const query = args?.query as string;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Search my memory for: ${query}`,
            },
          },
        ],
      };
    }

    if (name === "remember-conversation") {
      const summary = args?.summary as string;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Remember this: ${summary}`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // Resources handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "memory://user/profile",
          name: "User Profile",
          description: "Your preferences, background, and work style",
          mimeType: "text/plain",
        },
        {
          uri: "memory://documents/all",
          name: "All Documents",
          description: "List of all documents in your memory",
          mimeType: "application/json",
        },
        {
          uri: "memory://config/schema",
          name: "Configuration Schema",
          description: "JSON schema for configuring the CORE memory server",
          mimeType: "application/json",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "memory://user/profile") {
      const profile = await callMemoryTool(
        "memory_about_user",
        { sessionId, workspaceId },
        userId,
        source,
      );
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: profile.content[0].text,
          },
        ],
      };
    }

    if (uri === "memory://documents/all") {
      const docs = await callMemoryTool(
        "memory_get_documents",
        { sessionId, workspaceId, limit: 50 },
        userId,
        source,
      );
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: docs.content[0].text,
          },
        ],
      };
    }

    if (uri === "memory://config/schema") {
      const configSchema = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        title: "CORE Memory Server Configuration",
        description: "Configuration options for the CORE memory MCP server",
        properties: {
          source: {
            type: "string",
            description:
              "Source identifier for tracking where requests originate (e.g., 'claude-desktop', 'vscode')",
            default: "api",
          },
          integrations: {
            type: "array",
            description:
              "List of integration slugs to load (e.g., ['github', 'linear', 'slack']). Leave empty to load all available integrations.",
            items: {
              type: "string",
            },
            default: [],
          },
          no_integrations: {
            type: "boolean",
            description: "If true, disables loading of all integrations",
            default: false,
          },
          spaceId: {
            type: "string",
            description:
              "UUID of a space to associate memories with. Enables space-scoped memory organization.",
            format: "uuid",
          },
          skip_tools: {
            type: "array",
            description:
              "List of tool names to exclude from the tools list (e.g., ['memory_ingest', 'get_integrations']). Useful for hiding specific tools from clients.",
            items: {
              type: "string",
            },
            default: [],
          },
        },
      };
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(configSchema, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
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
  skipTools?: string[],
  noSession?: boolean,
): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: noSession ? undefined : () => sessionId,
    onsessioninitialized: async (sessionId) => {
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
      await fetchAndSaveIntegrations();
    }
  } catch (error) {
    logger.error(`Error loading integration transports: ${error}`);
  }

  // Create and connect MCP server
  const server = await createMcpServer(
    userId,
    workspaceId,
    sessionId,
    source,
    spaceId,
    skipTools,
  );
  await server.connect(transport);

  return transport;
}

export const recreateProtocolMessages = async (
  transport: StreamableHTTPServerTransport,
) => {
  await transport.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {
        roots: {
          listChanged: true,
        },
        sampling: {},
        elicitation: {},
      },
      clientInfo: {
        name: "Core cli",
        title: "Core",
        version: "1.0.0",
      },
    },
  });

  await transport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
};

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
  const skipTools = queryParams.skip_tools
    ? queryParams.skip_tools.split(",").map((s) => s.trim())
    : [];

  const userId = authentication.userId;
  const workspaceId = authentication.workspaceId;

  await ensureBillingInitialized(workspaceId, userId);

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
        // Session exists in DB but not in memory (server restarted)
        // For initialize requests, we can try to recreate the transport
        // For other requests, return 404 to force client to reinitialize

        logger.log(
          `Session ${sessionId} found in DB but not in memory. Recreating transport after server restart.`,
        );
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
            skipTools,
            true,
          );

          logger.log(`Successfully recreated session ${sessionId}`);
        } else {
          // Session was in DB but couldn't be retrieved - return 404
          return res.status(404).json({
            error: "session_not_found",
            message:
              "Session not found in database. Please initialize a new session.",
          });
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
        skipTools,
      );
    } else if (sessionId && !isInitializeRequest(body)) {
      // Session ID provided but session not active - return 404
      currentSessionId = randomUUID();
      transport = await createTransport(
        currentSessionId,
        source,
        integrations,
        noIntegrations,
        userId,
        workspaceId,
        spaceId,
        skipTools,
        true,
      );

      logger.log(`Successfully recreated session ${sessionId}`);
    } else {
      // No session ID and not an initialize request - invalid
      return res.status(400).json({
        error: "invalid_request",
        message: "Missing session ID. Please send an initialize request first.",
      });
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
  workspaceId: string,
  userId: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    // No session ID provided - client should send initialize request instead
    res.status(400).json({
      error: "invalid_request",
      message:
        "Missing mcp-session-id header. Please send an initialize request to create a new session.",
    });
    return;
  }

  // Check if session is active in database
  const isActive = await MCPSessionManager.isSessionActive(
    sessionId,
    workspaceId,
  );

  if (!isActive) {
    // Session terminated, expired, or never existed
    // Return 404 to signal client to start a new session
    res.status(405).json();
    return;
  }

  await ensureBillingInitialized(workspaceId, userId);

  const sessionData = TransportManager.getSessionInfo(sessionId);

  if (!sessionData.exists) {
    // Session exists in DB but not in memory (server restarted)
    // Return 404 to signal client to start a new session
    logger.log(
      `Session ${sessionId} found in DB but not in memory. Returning 404 to trigger new session initialization.`,
    );
    res.status(405).json();
    return;
  }

  // Session exists and is active, handle the request
  const transport = sessionData.mainTransport as StreamableHTTPServerTransport;
  await transport.handleRequest(req, res);
};
