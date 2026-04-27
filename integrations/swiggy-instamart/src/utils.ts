import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SWIGGY_INSTAMART_MCP_URL = "https://mcp.swiggy.com/im";

/**
 * Derive a stable accountId by querying `get_addresses` on the MCP server.
 * Falls back to a constant per-workspace identifier on failure.
 */
export async function fetchSwiggyAccountId(access_token: string): Promise<string> {
  let client: Client | null = null;
  try {
    client = new Client({ name: "swiggy-instamart-integration", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(SWIGGY_INSTAMART_MCP_URL),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${access_token}` },
        },
      },
    );
    await client.connect(transport);

    const result = await client.callTool({ name: "get_addresses", arguments: {} });
    const text = (result.content as any[])
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (text) {
      try {
        const parsed = JSON.parse(text);
        const id =
          parsed?.user_id ??
          parsed?.userId ??
          parsed?.mobile ??
          parsed?.phone ??
          parsed?.email ??
          parsed?.addresses?.[0]?.user_id ??
          parsed?.addresses?.[0]?.mobile;
        if (id) return `swiggy-instamart:${id}`;
      } catch {
        // fall through to default
      }
    }
  } catch {
    // fall through to default
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }

  return "swiggy-instamart-account";
}
