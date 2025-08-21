import { json } from "@remix-run/node";
import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { oauth2Service } from "~/services/oauth2.server";

// Dynamic Client Registration for MCP clients (Claude, etc.)
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { client_name, redirect_uris, grant_types, response_types } = body;

    // Validate required fields
    if (
      !redirect_uris ||
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0
    ) {
      return json(
        {
          error: "invalid_request",
          error_description: "redirect_uris is required",
        },
        { status: 400 },
      );
    }

    // Create MCP client with special handling
    const client = await oauth2Service.createDynamicClient({
      name: client_name || "MCP Client",
      redirectUris: redirect_uris,
      grantTypes: grant_types || ["authorization_code"],
      responseTypes: response_types || ["code"],
      clientType: "mcp", // Special flag for MCP clients
      requirePkce: true,
      allowedScopes: "mcp",
    });

    return json({
      client_id: client.clientId,
      client_secret: client.clientSecret, // Include if confidential client
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: client.grantTypes.split(","),
      response_types: ["code"],
      redirect_uris: client.redirectUris.split(","),
      scope: client.allowedScopes,
      token_endpoint_auth_method: "client_secret_basic",
    });
  } catch (error) {
    console.error("Dynamic client registration error:", error);
    return json(
      {
        error: "invalid_request",
        error_description: "Failed to register client",
      },
      { status: 400 },
    );
  }
}

// Prevent GET requests
export async function loader() {
  throw new Response("Method Not Allowed", { status: 405 });
}
