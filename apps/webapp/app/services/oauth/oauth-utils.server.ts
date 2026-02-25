import { type OAuth2Params } from "@core/types";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import type { IntegrationDefinitionV2 } from "@core/database";
import { z } from "zod";

export interface RedirectURLParams {
  workspaceSlug: string;
  integrationOAuthAppName: string;
  config: string;
}

export interface SessionRecord {
  integrationDefinitionId: string;
  config: OAuth2Params;
  redirectURL: string;
  workspaceId: string;
  accountIdentifier?: string;
  integrationKeys?: string;
  userId?: string;
  codeVerifier?: string;
}

export class OAuthBodyInterface {
  @IsString()
  redirectURL: string;

  @IsString()
  integrationDefinitionId: string;

  @IsString()
  @IsOptional()
  integrationAccountId?: string;
}

export const OAuthBodySchema = z.object({
  redirectURL: z.string(),
  integrationDefinitionId: z.string(),
  integrationAccountId: z.string().optional(),
});

export type CallbackParams = Record<string, string>;

export interface ProviderConfig {
  client_id: string;
  client_secret: string;
  scopes: string;
}

const enum ProviderAuthModes {
  "OAuth2" = "OAuth2",
}

export interface ProviderTemplate extends OAuth2Params {
  auth_mode: ProviderAuthModes;
}

export enum OAuthAuthorizationMethod {
  BODY = "body",
  HEADER = "header",
}

export enum OAuthBodyFormat {
  FORM = "form",
  JSON = "json",
}

export interface ProviderTemplateOAuth2 extends ProviderTemplate {
  auth_mode: ProviderAuthModes.OAuth2;

  disable_pkce?: boolean; // Defaults to false (=PKCE used) if not provided

  token_params?: {
    grant_type?: "authorization_code" | "client_credentials";
  };

  refresh_params?: {
    grant_type: "refresh_token";
  };

  authorization_method?: OAuthAuthorizationMethod;
  body_format?: OAuthBodyFormat;

  refresh_url?: string;

  token_request_auth_method?: "basic";
}

/**
 * A helper function to interpolate a string.
 * interpolateString('Hello ${name} of ${age} years", {name: 'Tester', age: 234}) -> returns 'Hello Tester of age 234 years'
 *
 * @remarks
 * Copied from https://stackoverflow.com/a/1408373/250880
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function interpolateString(str: string, replacers: Record<string, any>) {
  return str.replace(/\${([^{}]*)}/g, (a, b) => {
    const r = replacers[b];
    return typeof r === "string" || typeof r === "number" ? (r as string) : a; // Typecast needed to make TypeScript happy
  });
}

export function getSimpleOAuth2ClientConfig(
  providerConfig: ProviderConfig,
  template: ProviderTemplate,
  connectionConfig: OAuth2Params,
) {
  const tokenUrl = new URL(
    interpolateString(template.token_url, connectionConfig),
  );
  const authorizeUrl = new URL(
    interpolateString(template.authorization_url, connectionConfig),
  );
  const headers = { "User-Agent": "Sol" };

  const authConfig = template as ProviderTemplateOAuth2;

  return {
    client: {
      id: providerConfig.client_id,
      secret: providerConfig.client_secret,
    },
    auth: {
      tokenHost: tokenUrl.origin,
      tokenPath: tokenUrl.pathname,
      authorizeHost: authorizeUrl.origin,
      authorizePath: authorizeUrl.pathname,
    },
    http: { headers },
    options: {
      authorizationMethod:
        authConfig.authorization_method || OAuthAuthorizationMethod.BODY,
      bodyFormat: authConfig.body_format || OAuthBodyFormat.FORM,
      scopeSeparator: template.scope_separator || " ",
    },
  };
}

export async function getTemplate(
  integrationDefinition: IntegrationDefinitionV2,
): Promise<ProviderTemplate> {
  const spec = integrationDefinition.spec as any;
  const template: ProviderTemplate = spec.auth.OAuth2 as ProviderTemplate;

  if (!template) {
    throw new Error(
      `This extension doesn't support OAuth. Reach out to us if you need support for this extension`,
    );
  }

  return template;
}
