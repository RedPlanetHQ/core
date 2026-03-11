import { json } from "@remix-run/node";
import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import { getIntegrationDefinitionWithId } from "~/services/integrationDefinition.server";
import { getMcpAuthorizationUrl, type McpOAuthSession } from "~/utils/mcp/mcp-oauth.server";

const MCP_CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback/mcp-integration`;

// Session store for MCP integration OAuth flows
export const mcpIntegrationOAuthSession: Record<
  string,
  {
    userId: string;
    workspaceId: string;
    integrationDefinitionId: string;
    redirectURL: string;
    sessionData: McpOAuthSession;
  }
> = {};

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const workspace = await requireWorkpace(request);

  const formData = await request.formData();
  const integrationDefinitionId = formData.get("integrationDefinitionId") as string;
  const redirectURL =
    (formData.get("redirectURL") as string) || `${env.APP_ORIGIN}/home/integrations`;

  if (!integrationDefinitionId) {
    return json({ success: false, error: "Missing integrationDefinitionId" }, { status: 400 });
  }

  const integrationDefinition = await getIntegrationDefinitionWithId(integrationDefinitionId);
  if (!integrationDefinition) {
    return json({ success: false, error: "Integration not found" }, { status: 404 });
  }

  const spec = integrationDefinition.spec as any;
  const mcpAuth = spec?.auth?.mcp;
  if (!mcpAuth?.server_url) {
    return json(
      { success: false, error: "Integration does not support MCP OAuth" },
      { status: 400 },
    );
  }

  try {
    const { authUrl, sessionData } = await getMcpAuthorizationUrl({
      serverUrl: mcpAuth.server_url,
      redirectUrl: MCP_CALLBACK_URL,
      clientName: "Core MCP Client",
    });

    const state = crypto.randomUUID();
    mcpIntegrationOAuthSession[state] = {
      userId,
      workspaceId: workspace?.id as string,
      integrationDefinitionId,
      redirectURL,
      sessionData,
    };

    const authUrlObj = new URL(authUrl);
    if (!authUrlObj.searchParams.has("state")) {
      authUrlObj.searchParams.set("state", state);
    }

    logger.info(`MCP integration OAuth initiated for ${integrationDefinition.name}`);

    return json({ success: true, redirectURL: authUrlObj.toString() });
  } catch (error: any) {
    logger.error("MCP integration OAuth initiation error:", error);
    return json(
      { success: false, error: error.message || "Failed to initiate OAuth" },
      { status: 400 },
    );
  }
}
