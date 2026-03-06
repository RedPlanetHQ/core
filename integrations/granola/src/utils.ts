import axios from 'axios';

const GRANOLA_MCP_URL = 'https://mcp.granola.ai/mcp';
const GRANOLA_USERINFO_URL = 'https://mcp-auth.granola.ai/oauth2/userinfo';

let requestId = 1;

export async function getGranolaUserInfo(
  access_token: string,
): Promise<{ email: string; sub: string }> {
  const response = await axios.get(GRANOLA_USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return response.data;
}

export async function callGranolaToolRPC(
  config: Record<string, any>,
  toolName: string,
  args: Record<string, any> = {},
): Promise<any> {
  const response = await axios.post(
    GRANOLA_MCP_URL,
    {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: requestId++,
    },
    {
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (response.data.error) {
    throw new Error(response.data.error.message || 'Granola MCP error');
  }

  return response.data.result;
}
