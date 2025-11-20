import { IntegrationEventType, type OAuth2Params } from "@core/types";
import * as simpleOauth2 from "simple-oauth2";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  getSimpleOAuth2ClientConfig,
  getTemplate,
  type OAuthBodyInterface,
  type ProviderTemplateOAuth2,
  type SessionRecord,
} from "./oauth-utils.server";
import { getIntegrationDefinitionWithId } from "../integrationDefinition.server";
import { type scheduler } from "~/trigger/integrations/scheduler";
import { logger } from "../logger.service";
import { runIntegrationTrigger } from "../integration.server";
import type { IntegrationDefinitionV2 } from "@core/database";
import { env } from "~/env.server";
import { createMCPAuthClient } from "@core/mcp-proxy";

// Use process.env for config in Remix
const CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback`;
const MCP_CALLBACK_URL = `${CALLBACK_URL}/mcp`;

// Session store (in-memory, for single server)
const session: Record<string, SessionRecord> = {};
const mcpSession: Record<
  string,
  {
    integrationDefinitionId: string;
    redirectURL: string;
    workspaceId: string;
    userId: string;
    integrationAccountId: string;
  }
> = {};

export type CallbackParams = Record<string, string>;

// Remix-style callback handler
// Accepts a Remix LoaderFunctionArgs-like object: { request }
export async function callbackHandler(params: CallbackParams) {
  if (!params.state) {
    throw new Error("No state found");
  }

  const sessionRecord = session[params.state];

  // Delete the session once it's used
  delete session[params.state];

  if (!sessionRecord) {
    throw new Error("No session found");
  }

  const integrationDefinition = await getIntegrationDefinitionWithId(
    sessionRecord.integrationDefinitionId,
  );

  const template = (await getTemplate(
    integrationDefinition as IntegrationDefinitionV2,
  )) as ProviderTemplateOAuth2;

  if (integrationDefinition === null) {
    const errorMessage = "No matching integration definition found";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${sessionRecord.redirectURL}?success=false&error=${encodeURIComponent(
          errorMessage,
        )}`,
      },
    });
  }

  let additionalTokenParams: Record<string, string> = {};
  if (template.token_params !== undefined) {
    const deepCopy = JSON.parse(JSON.stringify(template.token_params));
    additionalTokenParams = deepCopy;
  }

  if (template.refresh_params) {
    additionalTokenParams = template.refresh_params;
  }

  const headers: Record<string, string> = {};

  const integrationConfig = integrationDefinition.config as any;
  const integrationSpec = integrationDefinition.spec as any;

  if (template.token_request_auth_method === "basic") {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${integrationConfig?.clientId}:${integrationConfig.clientSecret}`,
    ).toString("base64")}`;
  }

  const accountIdentifier = sessionRecord.accountIdentifier
    ? `&accountIdentifier=${encodeURIComponent(sessionRecord.accountIdentifier)}`
    : "";
  const integrationKeys = sessionRecord.integrationKeys
    ? `&integrationKeys=${encodeURIComponent(sessionRecord.integrationKeys)}`
    : "";

  try {
    const scopes = (integrationSpec.auth.OAuth2 as OAuth2Params)
      .scopes as string[];

    const simpleOAuthClient = new simpleOauth2.AuthorizationCode(
      getSimpleOAuth2ClientConfig(
        {
          client_id: integrationConfig.clientId,
          client_secret: integrationConfig.clientSecret,
          scopes: scopes.join(","),
        },
        template,
        sessionRecord.config,
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokensResponse: any = await simpleOAuthClient.getToken(
      {
        code: params.code as string,
        redirect_uri: CALLBACK_URL,
        ...additionalTokenParams,
      },
      {
        headers,
      },
    );

    const setupResult = await runIntegrationTrigger(
      integrationDefinition,
      {
        event: IntegrationEventType.SETUP,
        eventBody: {
          oauthResponse: tokensResponse.token,
          oauthParams: {
            ...params,
            redirect_uri: CALLBACK_URL,
          },
        },
      },
      sessionRecord.userId,
      sessionRecord.workspaceId,
    );

    await tasks.trigger<typeof scheduler>("scheduler", {
      integrationAccountId: setupResult?.account?.id,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${sessionRecord.redirectURL}?success=true&integrationName=${encodeURIComponent(
          integrationDefinition.name,
        )}${accountIdentifier}${integrationKeys}`,
      },
    });
  } catch (e: any) {
    logger.error(e);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${sessionRecord.redirectURL}?success=false&error=${encodeURIComponent(
          e.message,
        )}${accountIdentifier}${integrationKeys}`,
      },
    });
  }
}

export async function getRedirectURL(
  oAuthBody: OAuthBodyInterface,
  userId: string,
  workspaceId?: string,
  specificScopes?: string,
) {
  const { integrationDefinitionId } = oAuthBody;

  const redirectURL = oAuthBody.redirectURL ?? `${env.APP_ORIGIN}/integrations`;

  logger.info(
    `We got OAuth request for ${workspaceId}: ${integrationDefinitionId}`,
  );

  const integrationDefinition = await getIntegrationDefinitionWithId(
    integrationDefinitionId,
  );

  if (!integrationDefinition) {
    throw new Error("No integration definition ");
  }

  const spec = integrationDefinition.spec as any;
  const externalConfig = spec.auth.OAuth2 as OAuth2Params;
  const template = await getTemplate(integrationDefinition);

  const scopesString =
    specificScopes || (externalConfig.scopes as string[]).join(",");
  const additionalAuthParams = template.authorization_params || {};

  const integrationConfig = integrationDefinition.config as any;

  try {
    const simpleOAuthClient = new simpleOauth2.AuthorizationCode(
      getSimpleOAuth2ClientConfig(
        {
          client_id: integrationConfig.clientId,
          client_secret: integrationConfig.clientSecret,
          scopes: scopesString,
        },
        template,
        externalConfig,
      ),
    );

    const uniqueId = Date.now().toString(36);
    session[uniqueId] = {
      integrationDefinitionId: integrationDefinition.id,
      redirectURL,
      workspaceId: workspaceId as string,
      config: externalConfig,
      userId,
    };

    const scopes = [
      ...scopesString.split(","),
      ...(template.default_scopes || []),
    ];

    const scopeIdentifier = externalConfig.scope_identifier ?? "scope";

    const authorizationUri = simpleOAuthClient.authorizeURL({
      redirect_uri: CALLBACK_URL,
      [scopeIdentifier]: scopes.join(template.scope_separator || " "),
      state: uniqueId,
      ...additionalAuthParams,
    });

    logger.debug(
      `OAuth 2.0 for ${integrationDefinition.name} - redirecting to: ${authorizationUri}`,
    );

    return {
      status: 200,
      redirectURL: authorizationUri,
    };
  } catch (e: any) {
    logger.warn(e);
    throw new Error(e.message);
  }
}

export async function getRedirectURLForMCP(
  oAuthBody: OAuthBodyInterface,
  userId: string,
  workspaceId?: string,
) {
  const { integrationDefinitionId, integrationAccountId } = oAuthBody;

  logger.info(
    `We got OAuth request for ${workspaceId}: ${userId}: ${integrationDefinitionId}`,
  );

  const redirectURL = oAuthBody.redirectURL ?? `${env.APP_ORIGIN}/integrations`;

  const integrationDefinition = await getIntegrationDefinitionWithId(
    integrationDefinitionId,
  );

  if (!integrationAccountId) {
    throw new Error("No integration account found");
  }

  if (!integrationDefinition) {
    throw new Error("No integration definition found");
  }

  const spec = integrationDefinition.spec as any;

  if (!spec.mcp) {
    throw new Error("MCP auth configuration not found for this integration");
  }

  const { url, transportStrategy } = spec.mcp;

  const authClient = createMCPAuthClient({
    serverUrl: url,
    transportStrategy: transportStrategy || "sse-first",
    redirectUrl: MCP_CALLBACK_URL,
  });

  const { authUrl, state } = await authClient.getAuthorizationURL({
    scope: "read write",
  });

  mcpSession[state] = {
    integrationDefinitionId: integrationDefinition.id,
    redirectURL,
    userId,
    workspaceId: workspaceId as string,
    integrationAccountId,
  };

  return {
    status: 200,
    redirectURL: authUrl,
  };
}

export async function getIntegrationDefinitionForState(state: string) {
  try {
    if (!state) {
      throw new Error("No state found");
    }

    const sessionRecord = mcpSession[state];

    // Delete the session once it's used
    delete mcpSession[state];

    return sessionRecord;
  } catch (e) {
    throw new Error("No state found");
  }
}
