import { type LoaderFunctionArgs } from "@remix-run/node";
import { getIntegrationDefinitionWithId } from "~/services/integrationDefinition.server";
import { runIntegrationTrigger } from "~/services/integration.server";
import { IntegrationEventType } from "@core/types";
import { createMCPAuthClient } from "@core/mcp-proxy";
import { logger } from "~/services/logger.service";
import { env } from "~/env.server";
import { getIntegrationDefinitionForState } from "~/services/oauth/oauth.server";
import { getIntegrationAccountForId } from "~/services/integrationAccount.server";

const CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback`;
const MCP_CALLBACK_URL = `${CALLBACK_URL}/mcp`;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authorizationCode = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!authorizationCode || !state) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}/integrations?success=false&error=${encodeURIComponent(
          "Missing authorization code or state",
        )}`,
      },
    });
  }

  const {
    integrationDefinitionId,
    redirectURL,
    userId,
    workspaceId,
    integrationAccountId,
  } = await getIntegrationDefinitionForState(state);

  try {
    // For now, we'll assume Linear integration - in the future this should be derived from state
    const integrationDefinition = await getIntegrationDefinitionWithId(
      integrationDefinitionId,
    );

    const integrationAccount =
      await getIntegrationAccountForId(integrationAccountId);

    if (!integrationDefinition) {
      throw new Error("Integration definition not found");
    }

    const spec = integrationDefinition.spec as any;

    if (!spec.mcp) {
      throw new Error("MCP auth configuration not found for this integration");
    }

    const { transportStrategy, url } = spec.mcp;

    const authClient = createMCPAuthClient({
      serverUrl: url,
      transportStrategy: transportStrategy || "sse-first",
      redirectUrl: MCP_CALLBACK_URL,
    });

    const result = await authClient.completeOAuthFlow({
      authorizationCode,
      state,
      scope: "read write",
    });

    // Run integration trigger with MCP OAuth response
    await runIntegrationTrigger(
      integrationDefinition,
      {
        event: IntegrationEventType.SETUP,
        eventBody: {
          oauthResponse: result,
          oauthParams: {
            code: authorizationCode,
            state,
            redirect_uri: MCP_CALLBACK_URL,
          },
          mcp: true,
        },
      },
      // We need to get userId from somewhere - for now using undefined
      userId,
      workspaceId,
      integrationAccount ?? undefined,
    );

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectURL}?success=true&integrationName=${encodeURIComponent(
          integrationDefinition.name,
        )}`,
      },
    });
  } catch (error: any) {
    logger.error("MCP OAuth callback error:", error);

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
