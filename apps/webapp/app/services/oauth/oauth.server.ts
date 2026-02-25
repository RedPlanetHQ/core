import { type OAuth2Params } from "@core/types";
import * as simpleOauth2 from "simple-oauth2";
import crypto from "crypto";
import {
  getSimpleOAuth2ClientConfig,
  getTemplate,
  type OAuthBodyInterface,
  type ProviderTemplateOAuth2,
  type SessionRecord,
} from "./oauth-utils.server";
import { getIntegrationDefinitionWithId } from "../integrationDefinition.server";

import { logger } from "../logger.service";
import { IntegrationRunner } from "~/services/integrations/integration-runner";
import type { IntegrationDefinitionV2 } from "@core/database";
import { env } from "~/env.server";
import { scheduler } from "./scheduler";

// PKCE utilities
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// Use process.env for config in Remix
const CALLBACK_URL = `${env.APP_ORIGIN}/api/v1/oauth/callback`;

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

  // Handle OAuth errors returned by the provider
  if (params.error) {
    const errorMessage =
      params.error_description || params.error || "OAuth authorization failed";
    logger.error("OAuth provider error:", {
      error: params.error,
      description: params.error_description,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${sessionRecord.redirectURL}?success=false&error=${encodeURIComponent(
          errorMessage,
        )}`,
      },
    });
  }

  const integrationDefinition = await getIntegrationDefinitionWithId(
    sessionRecord.integrationDefinitionId,
  );

  const template = (await getTemplate(
    integrationDefinition as IntegrationDefinitionV2,
  )) as ProviderTemplateOAuth2;

  // Zoho fix
  if (params["accounts-server"]) {
    template["token_url"] = template.token_url.replace(
      "https://accounts.zoho.com",
      params["accounts-server"],
    );
  }

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

    // Add code_verifier for PKCE if it was used during authorization
    const pkceTokenParams = sessionRecord.codeVerifier
      ? { code_verifier: sessionRecord.codeVerifier }
      : {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokensResponse: any = await simpleOAuthClient.getToken(
      {
        code: params.code as string,
        redirect_uri: CALLBACK_URL,
        ...additionalTokenParams,
        ...pkceTokenParams,
      },
      {
        headers,
      },
    );

    const messages = await IntegrationRunner.setup({
      eventBody: {
        oauthResponse: tokensResponse.token,
        oauthParams: {
          ...params,
          redirect_uri: CALLBACK_URL,
        },
      },
      integrationDefinition: integrationDefinition as any,
    });

    // Handle the setup result - process account messages
    const setupResult = await IntegrationRunner.handleSetupMessages(
      messages,
      integrationDefinition as any,
      sessionRecord.workspaceId,
      sessionRecord.userId as string,
    );

    await scheduler({
      integrationAccountId: setupResult?.account?.id as string,
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
    logger.error("OAuth callback error:", e);
    if (e.data)
      logger.error("OAuth error data:", { error: JSON.stringify(e.data) });

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
  console.log(`Generating redirect for ${integrationDefinition.name}`, {
    clientId: integrationConfig?.clientId ? "exists" : "missing",
    scopes: scopesString,
  });

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

    // Generate PKCE code_verifier if PKCE is not disabled
    const usePkce = !template.disable_pkce;
    const codeVerifier = usePkce ? generateCodeVerifier() : undefined;

    session[uniqueId] = {
      integrationDefinitionId: integrationDefinition.id,
      redirectURL,
      workspaceId: workspaceId as string,
      config: externalConfig,
      userId,
      codeVerifier,
    };

    const scopes = [
      ...scopesString.split(","),
      ...(template.default_scopes || []),
    ];

    const scopeIdentifier = externalConfig.scope_identifier ?? "scope";

    // Add PKCE params to authorization URL if enabled
    const pkceParams = codeVerifier
      ? {
          code_challenge: generateCodeChallenge(codeVerifier),
          code_challenge_method: "S256",
        }
      : {};

    const authorizationUri = simpleOAuthClient.authorizeURL({
      redirect_uri: CALLBACK_URL,
      [scopeIdentifier]: scopes.join(template.scope_separator || " "),
      state: uniqueId,
      ...additionalAuthParams,
      ...pkceParams,
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
