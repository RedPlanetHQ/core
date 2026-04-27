import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SWIGGY_INSTAMART_MCP_URL = "https://mcp.swiggy.com/im";

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  annotations?: Record<string, any>;
}

interface MCPToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

async function createMCPClient(accessToken: string): Promise<Client> {
  const client = new Client({
    name: "swiggy-instamart-integration",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(SWIGGY_INSTAMART_MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  await client.connect(transport);

  return client;
}

export async function getTools(config?: Record<string, string>): Promise<MCPTool[]> {
  if (!config?.access_token) {
    return [];
  }

  let client: Client | null = null;

  try {
    client = await createMCPClient(config.access_token);
    const { tools } = await client.listTools();

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
  } catch (error: any) {
    console.error("Error fetching tools from Swiggy Instamart MCP:", error.message);
    return [];
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function callTool(
  name: string,
  args: Record<string, any>,
  credentials: Record<string, string>,
): Promise<MCPToolCallResult> {
  let client: Client | null = null;

  try {
    client = await createMCPClient(credentials.access_token);

    const result = await client.callTool({
      name,
      arguments: args,
    });

    return {
      content: result.content as MCPToolCallResult["content"],
      isError: result.isError as boolean,
    };
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";

    return {
      content: [{ type: "text", text: `Error calling tool '${name}': ${errorMessage}` }],
      isError: true,
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
}
