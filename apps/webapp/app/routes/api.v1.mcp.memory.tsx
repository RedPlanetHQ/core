import { json } from "@remix-run/node";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createHybridActionApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { addToQueue } from "~/lib/ingest.server";
import { SearchService } from "~/services/search.server";
import { handleTransport } from "~/utils/mcp";

// Map to store transports by session ID with cleanup tracking
const transports: {
  [sessionId: string]: {
    transport: StreamableHTTPServerTransport;
    createdAt: number;
  };
} = {};

// Cleanup old sessions every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    Object.keys(transports).forEach((sessionId) => {
      if (now - transports[sessionId].createdAt > maxAge) {
        transports[sessionId].transport.close();
        delete transports[sessionId];
      }
    });
  },
  5 * 60 * 1000,
);

// MCP request body schema
const MCPRequestSchema = z.object({}).passthrough();

// Search parameters schema for MCP tool
const SearchParamsSchema = z.object({
  query: z.string().describe("The search query in third person perspective"),
  validAt: z.string().optional().describe("The valid at time in ISO format"),
  startTime: z.string().optional().describe("The start time in ISO format"),
  endTime: z.string().optional().describe("The end time in ISO format"),
});

const IngestSchema = z.object({
  message: z.string().describe("The data to ingest in text format"),
});

const searchService = new SearchService();

// Handle MCP HTTP requests properly
const handleMCPRequest = async (
  request: Request,
  body: any,
  authentication: any,
) => {
  const sessionId = request.headers.get("mcp-session-id") as string | undefined;
  const source = request.headers.get("source") as string | undefined;

  if (!source) {
    return json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "No source found",
        },
        id: null,
      },
      { status: 400 },
    );
  }

  let transport: StreamableHTTPServerTransport;

  try {
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId].transport;
    } else if (!sessionId && isInitializeRequest(body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID with timestamp
          transports[sessionId] = {
            transport,
            createdAt: Date.now(),
          };
        },
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      const server = new McpServer(
        {
          name: "echo-memory-server",
          version: "1.0.0",
        },
        {
          capabilities: {
            tools: {},
          },
        },
      );

      // Register ingest tool
      server.registerTool(
        "ingest",
        {
          title: "Ingest Data",
          description: "Ingest data into the memory system",
          inputSchema: IngestSchema.shape,
        },
        async (args) => {
          try {
            const userId = authentication.userId;

            const response = addToQueue(
              {
                episodeBody: args.message,
                referenceTime: new Date().toISOString(),
                source,
              },
              userId,
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(response),
                },
              ],
            };
          } catch (error) {
            console.error("MCP ingest error:", error);
            return {
              content: [
                {
                  type: "text",
                  text: `Error ingesting data: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );

      // Register search tool
      server.registerTool(
        "search",
        {
          title: "Search Data",
          description: "Search through ingested data",
          inputSchema: SearchParamsSchema.shape,
        },
        async (args) => {
          try {
            const userId = authentication.userId;

            const results = await searchService.search(args.query, userId, {
              startTime: args.startTime ? new Date(args.startTime) : undefined,
              endTime: args.endTime ? new Date(args.endTime) : undefined,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(results),
                },
              ],
            };
          } catch (error) {
            console.error("MCP search error:", error);
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        },
      );

      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      throw new Error("Bad Request: No valid session ID provided");
    }

    const response = await handleTransport(transport, request, body);

    return response;
  } catch (error) {
    console.error("MCP request error:", error);
    return json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            error instanceof Error ? error.message : "Internal server error",
        },
        id: body?.id || null,
      },
      { status: 500 },
    );
  }
};

// Handle DELETE requests for session cleanup
const handleDelete = async (request: Request, authentication: any) => {
  const sessionId = request.headers.get("mcp-session-id") as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    return new Response("Invalid or missing session ID", { status: 400 });
  }

  const transport = transports[sessionId].transport;

  // Clean up transport
  transport.close();
  delete transports[sessionId];

  return new Response(null, { status: 204 });
};

const { action, loader } = createHybridActionApiRoute(
  {
    body: MCPRequestSchema,
    allowJWT: true,
    authorization: {
      action: "mcp",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication, request }) => {
    const method = request.method;

    if (method === "POST") {
      return await handleMCPRequest(request, body, authentication);
    } else if (method === "DELETE") {
      return await handleDelete(request, authentication);
    } else {
      return json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: "Method not allowed",
          },
          id: null,
        },
        { status: 405 },
      );
    }
  },
);

export { action, loader };
