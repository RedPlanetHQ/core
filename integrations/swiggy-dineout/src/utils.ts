import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SWIGGY_DINEOUT_MCP_URL = "https://mcp.swiggy.com/dineout";

/**
 * Derive a stable accountId by querying `get_saved_locations` on the MCP server
 * (Dineout's equivalent of get_addresses). Falls back to a constant per-workspace
 * identifier on failure.
 */
export async function fetchSwiggyAccountId(access_token: string): Promise<string> {
  let client: Client | null = null;
  try {
    client = new Client({ name: "swiggy-dineout-integration", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(SWIGGY_DINEOUT_MCP_URL),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${access_token}` },
        },
      },
    );
    await client.connect(transport);

    const result = await client.callTool({
      name: "get_saved_locations",
      arguments: {},
    });
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
          parsed?.locations?.[0]?.user_id ??
          parsed?.addresses?.[0]?.user_id;
        if (id) return `swiggy-dineout:${id}`;
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

  return "swiggy-dineout-account";
}
