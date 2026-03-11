import { type LoaderFunctionArgs } from "@remix-run/node";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { mcpIntegrationOAuthSession } from "./api.v1.oauth.mcp-integration";
import { getIntegrationDefinitionWithId } from "~/services/integrationDefinition.server";
import { IntegrationRunner } from "~/services/integrations/integration-runner";
import { scheduler } from "~/services/oauth/scheduler";
import { completeMcpOAuth } from "~/utils/mcp/mcp-oauth.server";

const MCP_CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback/mcp-integration`;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authorizationCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!authorizationCode || !state) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/home/integrations?success=false&error=${encodeURIComponent(
          "Missing authorization code or state",
        )}`,
      },
    });
  }

  const session = mcpIntegrationOAuthSession[state];
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/home/integrations?success=false&error=${encodeURIComponent(
          "Invalid or expired session",
        )}`,
      },
    });
  }

  const { userId, workspaceId, integrationDefinitionId, redirectURL, sessionData } = session;
  delete mcpIntegrationOAuthSession[state];

  try {
    const integrationDefinition = await getIntegrationDefinitionWithId(integrationDefinitionId);
    if (!integrationDefinition) {
      throw new Error("Integration not found");
    }

    const spec = integrationDefinition.spec as any;
    const serverUrl = spec?.auth?.mcp?.server_url;

    const result = await completeMcpOAuth({
      serverUrl,
      redirectUrl: MCP_CALLBACK_URL,
      authorizationCode,
      sessionData,
      clientName: "Core MCP Client",
    });

    const messages = await IntegrationRunner.setup({
      eventBody: {
        oauthResponse: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          expires_in: result.expiresIn,
          token_type: result.tokenType,
        },
        oauthParams: { redirect_uri: MCP_CALLBACK_URL },
      },
      integrationDefinition: integrationDefinition as any,
    });

    const setupResult = await IntegrationRunner.handleSetupMessages(
      messages,
      integrationDefinition as any,
      workspaceId,
      userId,
    );

    await scheduler({
      integrationAccountId: setupResult?.account?.id as string,
    });

    logger.info(`MCP integration OAuth completed for ${integrationDefinition.name}`);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectURL}?success=true&integrationName=${encodeURIComponent(
          integrationDefinition.name,
        )}`,
      },
    });
  } catch (error: any) {
    logger.error("MCP integration OAuth callback error:", error);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectURL}?success=false&error=${encodeURIComponent(
          error.message || "OAuth callback failed",
        )}`,
      },
    });
  }
}
