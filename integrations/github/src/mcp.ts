import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Creates an MCP client with HTTP streamable transport
 */
async function createMcpClient(serverUrl: string, headers?: Record<string, string>) {
  const client = new Client({ name: 'github-integration', version: '1.0.0' });

  const url = new URL(serverUrl);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: headers || {} },
  });

  await client.connect(transport);

  return client;
}

/**
 * Get list of available tools from MCP server
 * @param serverUrl - The URL of the MCP server
 * @param headers - Optional headers to include in the request
 * @returns Array of available tools
 */
export async function getTools(config?: Record<string, string>) {
  const client = await createMcpClient('https://api.githubcopilot.com/mcp/x/all', {
    Authorization: `Bearer ${config?.access_token}`,
  });

  try {
    const response = await client.listTools();
    return response.tools;
  } finally {
    await client.close();
  }
}

/**
 * Call a specific tool on the MCP server
 * @param serverUrl - The URL of the MCP server
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @param headers - Optional headers to include in the request
 * @returns Result from the tool call
 */
export async function callTool(
  toolName: string,
  args: Record<string, any>,
  config?: Record<string, string>,
) {
  const client = await createMcpClient('https://api.githubcopilot.com/mcp/x/all', {
    Authorization: `Bearer ${config?.access_token}`,
  });

  try {
    const response = await client.callTool({ name: toolName, arguments: args });
    return response;
  } finally {
    await client.close();
  }
}
