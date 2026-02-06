import { findUserByToken } from "~/models/personal-token.server";
import { oauth2Service } from "~/services/oauth2.server";
import { type Request as ERequest } from "express";
// See this for more: https://twitter.com/mattpocockuk/status/1653403198885904387?s=20
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type ApiAuthenticationResult =
  | ApiAuthenticationResultSuccess
  | ApiAuthenticationResultFailure;

export type ApiAuthenticationResultSuccess = {
  ok: true;
  apiKey: string;
  type: "PRIVATE" | "OAUTH2";
  userId: string;
  workspaceId?: string;
  scopes?: string[];
  oneTimeUse?: boolean;
  oauth2?: {
    clientId: string;
    scope: string | null;
  };
};

export type ApiAuthenticationResultFailure = {
  ok: false;
  error: string;
};

/**
 * This method is the same as `authenticateApiRequest` but it returns a failure result instead of undefined.
 * It should be used from now on to ensure that the API key is always validated and provide a failure result.
 */
export async function authenticateApiRequestWithFailure(
  request: Request,
  options: { allowPublicKey?: boolean; allowJWT?: boolean } = {},
): Promise<ApiAuthenticationResult> {
  const apiKey = getApiKeyFromRequest(request);

  if (!apiKey) {
    return {
      ok: false,
      error: "Invalid API Key",
    };
  }

  const authentication = await authenticateApiKeyWithFailure(apiKey, options);

  return authentication;
}

/**
 * This method is the same as `authenticateApiKey` but it returns a failure result instead of undefined.
 * It should be used from now on to ensure that the API key is always validated and provide a failure result.
 */
export async function authenticateApiKeyWithFailure(
  apiKey: string,
  options: { allowPublicKey?: boolean; allowJWT?: boolean } = {},
): Promise<ApiAuthenticationResult> {
  // First try OAuth2 access token
  try {
    const accessToken = await oauth2Service.validateAccessToken(apiKey);
    if (accessToken) {
      return {
        ok: true,
        apiKey,
        type: "OAUTH2",
        userId: accessToken.user.id,
        workspaceId: accessToken.workspaceId,
        scopes: accessToken.scope ? accessToken.scope.split(" ") : undefined,
        oauth2: {
          clientId: accessToken.client.clientId,
          scope: accessToken.scope,
        },
      };
    }
  } catch (error) {
    // If OAuth2 token validation fails, continue to PAT validation
  }

  // Fall back to PAT authentication
  const result = getApiKeyResult(apiKey);

  if (!result) {
    return {
      ok: false,
      error: "Invalid API Key",
    };
  }

  switch (result.type) {
    case "PRIVATE": {
      const user = await findUserByToken(result.apiKey);
      if (!user) {
        return {
          ok: false,
          error: "Invalid API Key",
        };
      }

      return {
        ok: true,
        ...result,
        userId: user.userId,
        workspaceId: user.workspaceId,
      };
    }
  }
}

export function isSecretApiKey(key: string) {
  return key.startsWith("rc_");
}

export function getApiKeyFromRequest(request: Request | ERequest) {
  const authorizationHeader =
    request instanceof Request
      ? request.headers.get("Authorization")
      : request.headers["authorization"];

  return getApiKeyFromHeader(authorizationHeader);
}

export function getApiKeyFromHeader(authorization?: string | null) {
  if (typeof authorization !== "string" || !authorization) {
    return;
  }

  const apiKey = authorization.replace(/^Bearer /, "");
  return apiKey;
}

export function getApiKeyResult(apiKey: string): {
  apiKey: string;
  type: "PRIVATE";
} {
  return { apiKey, type: "PRIVATE" };
}

/**
 * Authenticate OAuth2 requests specifically
 * Returns structured result for OAuth endpoints
 */
export async function authenticateOAuthRequest(
  request: Request,
  scopes?: string[],
): Promise<{
  success: boolean;
  user?: { id: string };
  clientId?: string;
  error?: string;
}> {
  const apiKey = getApiKeyFromRequest(request);

  if (!apiKey) {
    return {
      success: false,
      error: "Missing authorization header",
    };
  }

  // Only allow OAuth2 tokens for OAuth API endpoints
  try {
    const accessToken = await oauth2Service.validateAccessToken(apiKey, scopes);
    if (accessToken) {
      return {
        success: true,
        user: { id: accessToken.user.id },
        clientId: accessToken.client.clientId,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: "Invalid or expired access token",
    };
  }

  return {
    success: false,
    error: "Invalid access token",
  };
}
