import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { env } from "~/env.server";
import { type JWTPayload, jwtVerify, SignJWT } from "jose";

const prisma = new PrismaClient();

export interface OAuth2AuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export interface OAuth2TokenRequest {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  client_id: string;
  client_secret?: string;
  code_verifier?: string;
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface OAuth2ErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
  state?: string;
}

export interface IDTokenClaims {
  iss: string; // Issuer
  aud: string; // Audience (client_id)
  sub: string; // Subject (user ID)
  exp: number; // Expiration time
  iat: number; // Issued at
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  installation_id?: string;
}

// OAuth2 Error types
export const OAuth2Errors = {
  INVALID_REQUEST: "invalid_request",
  INVALID_CLIENT: "invalid_client",
  INVALID_GRANT: "invalid_grant",
  UNAUTHORIZED_CLIENT: "unauthorized_client",
  UNSUPPORTED_GRANT_TYPE: "unsupported_grant_type",
  INVALID_SCOPE: "invalid_scope",
  ACCESS_DENIED: "access_denied",
  UNSUPPORTED_RESPONSE_TYPE: "unsupported_response_type",
  SERVER_ERROR: "server_error",
  TEMPORARILY_UNAVAILABLE: "temporarily_unavailable",
} as const;

export class OAuth2Service {
  private generateAccessToken(params: {
    userId: string;
    clientId: string;
    workspaceId: string;
    scope?: string;
  }): string {
    const payload = {
      type: "access_token",
      user_id: params.userId,
      client_id: params.clientId,
      workspace_id: params.workspaceId,
      scope: params.scope,
      jti: crypto.randomBytes(16).toString("hex"),
      iat: Math.floor(Date.now() / 1000),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

    return `at_${encoded}`;
  }

  private generateRefreshToken(params: {
    userId: string;
    clientId: string;
    workspaceId: string;
  }): string {
    const payload = {
      type: "refresh_token",
      user_id: params.userId,
      client_id: params.clientId,
      workspace_id: params.workspaceId,
      jti: crypto.randomBytes(16).toString("hex"),
      iat: Math.floor(Date.now() / 1000),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

    return `rt_${encoded}`;
  }

  private generateAuthorizationCode(params: {
    clientId: string;
    userId: string;
    workspaceId: string;
  }): string {
    const payload = {
      type: "authorization_code",
      client_id: params.clientId,
      user_id: params.userId,
      workspace_id: params.workspaceId,
      jti: crypto.randomBytes(12).toString("hex"),
      iat: Math.floor(Date.now() / 1000),
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

    return `ac_${encoded}`;
  }

  private async generateIdToken(params: {
    userId: string;
    clientId: string;
    workspaceId: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
    installationId?: string;
    scopes?: string[];
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    const claims: IDTokenClaims = {
      iss: env.LOGIN_ORIGIN,
      aud: params.clientId,
      sub: params.userId,
      exp,
      iat: now,
    };

    // Add optional claims based on scopes
    if (params.scopes?.includes("email") && params.email) {
      claims.email = params.email;
      claims.email_verified = true; // Assuming all CORE emails are verified
    }

    if (params.scopes?.includes("profile")) {
      if (params.name) claims.name = params.name;
      if (params.avatarUrl) claims.picture = params.avatarUrl;
    }

    if (params.installationId) {
      claims.installation_id = params.installationId;
    }

    // Sign JWT with secret
    const secret = new TextEncoder().encode(env.SESSION_SECRET);

    return await new SignJWT(claims as JWTPayload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(secret);
  }

  private extractTokenPayload(token: string): any {
    try {
      const parts = token.split("_");
      if (parts.length !== 2) return null;

      const encoded = parts[1];
      const decoded = Buffer.from(encoded, "base64url").toString();
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  private validateTokenFormat(
    token: string,
    expectedType: "access_token" | "refresh_token" | "authorization_code",
  ): any {
    try {
      const prefixMap = {
        access_token: "at_",
        refresh_token: "rt_",
        authorization_code: "ac_",
      };

      const expectedPrefix = prefixMap[expectedType];

      if (!token.startsWith(expectedPrefix)) {
        return null;
      }

      const payload = this.extractTokenPayload(token);

      if (!payload || payload.type !== expectedType) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  // Validate OAuth2 client
  async validateClient(clientId: string, clientSecret?: string): Promise<any> {
    const client = await prisma.oAuthClient.findUnique({
      where: {
        clientId,
        isActive: true,
      },
      include: {
        workspace: true,
      },
    });

    if (!client) {
      throw new Error(OAuth2Errors.INVALID_CLIENT);
    }

    // If client secret is provided, validate it
    if (clientSecret && client.clientSecret !== clientSecret) {
      throw new Error(OAuth2Errors.INVALID_CLIENT);
    }

    return client;
  }

  // Validate redirect URI
  validateRedirectUri(client: any, redirectUri: string): boolean {
    const allowedUris = client.redirectUris
      .split(",")
      .map((uri: string) => uri.trim());
    return allowedUris.includes(redirectUri);
  }

  // Validate PKCE challenge
  validatePkceChallenge(
    codeVerifier: string,
    codeChallenge: string,
    method: string = "S256",
  ): boolean {
    if (method === "S256") {
      const hash = crypto.createHash("sha256").update(codeVerifier).digest();
      const challenge = hash.toString("base64url");
      return challenge === codeChallenge;
    } else if (method === "plain") {
      return codeVerifier === codeChallenge;
    }
    return false;
  }

  // Validate scopes against client's allowed scopes
  validateScopes(client: any, requestedScopes: string): boolean {
    const allowedScopes = client.allowedScopes
      .split(",")
      .map((s: string) => s.trim());
    const requestedScopeArray = requestedScopes
      .split(",")
      .map((s: string) => s.trim());

    return requestedScopeArray.every((scope) => allowedScopes.includes(scope));
  }

  async verifyIdToken(idToken: string): Promise<IDTokenClaims> {
    try {
      const secret = new TextEncoder().encode(env.SESSION_SECRET);
      const { payload } = await jwtVerify(idToken, secret);
      return payload as IDTokenClaims;
    } catch (error) {
      throw new Error("Invalid ID token");
    }
  }

  // Determine scope type for routing (simplified)
  getScopeType(scope: string): "auth" | "integration" | "mixed" {
    const scopes = scope.split(",").map((s) => s.trim());

    // Google-style auth scopes
    const authScopes = ["profile", "email", "openid"];
    // Integration-related scopes
    const integrationScopes = [
      "integration",
      "integration:read",
      "integration:credentials",
      "integration:manage",
      "integration:webhook",
    ];

    // MCP-related scopes
    const mcpScopes = ["mcp", "mcp:read", "mcp:write"];

    const hasAuthScopes = scopes.some((s) => authScopes.includes(s));
    const hasIntegrationScopes = scopes.some((s) =>
      integrationScopes.includes(s),
    );

    if (hasAuthScopes && hasIntegrationScopes) {
      return "mixed";
    } else if (hasAuthScopes) {
      return "auth";
    } else if (hasIntegrationScopes) {
      return "integration";
    }

    // Default to auth for unknown scopes
    return "auth";
  }

  // Get scope descriptions for UI
  getScopeDescriptions(
    scopes: string[],
  ): Array<{ scope: string; description: string; icon: string }> {
    const scopeMap: Record<string, { description: string; icon: string }> = {
      profile: {
        description: "Access your profile information",
        icon: "user",
      },
      email: { description: "Access your email address", icon: "mail" },
      openid: { description: "Verify your identity", icon: "shield" },
      integration: {
        description: "Access your workspace integrations",
        icon: "database",
      },
      "integration:read": {
        description: "Read integration metadata and status",
        icon: "eye",
      },
      "integration:credentials": {
        description: "Access integration account credentials",
        icon: "key",
      },
      "integration:manage": {
        description: "Create, update, and delete integrations",
        icon: "settings",
      },
      "integration:webhook": {
        description: "Manage integration webhooks",
        icon: "webhook",
      },
      mcp: {
        description: "Access MCP endpoints",
        icon: "mcp",
      },
      "mcp:read": {
        description: "Read MCP endpoints",
        icon: "eye",
      },
      "mcp:write": {
        description: "Write to MCP endpoints",
        icon: "pencil",
      },
    };

    return scopes.map((scope) => ({
      scope,
      description: scopeMap[scope]?.description || `Access to ${scope}`,
      icon: scopeMap[scope]?.icon || "align-left",
    }));
  }

  // Create authorization code
  async createAuthorizationCode(params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    workspaceId: string;
    scope?: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }): Promise<string> {
    const code = this.generateAuthorizationCode(params);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Find the client to get the internal database ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
    });
    if (!client) {
      throw new Error(OAuth2Errors.INVALID_CLIENT);
    }

    try {
      await prisma.oAuthAuthorizationCode.create({
        data: {
          code,
          clientId: client.id,
          userId: params.userId,
          redirectUri: params.redirectUri,
          scope: params.scope,
          state: params.state,
          codeChallenge: params.codeChallenge,
          codeChallengeMethod: params.codeChallengeMethod,
          workspaceId: params.workspaceId,
          expiresAt,
        },
      });
    } catch (error) {
      throw new Error("Failed to create authorization code");
    }

    return code;
  }

  async validateAuthorizationCode(code: string): Promise<any> {
    const tokenPayload = this.validateTokenFormat(code, "authorization_code");
    if (!tokenPayload) {
      throw new Error("Invalid or expired token");
    }

    const authorizationCode = await prisma.oAuthAuthorizationCode.findFirst({
      where: {
        code,
        workspaceId: tokenPayload.workspace_id,
        expiresAt: { gt: new Date() },
      },
      include: {
        client: true,
        user: true,
      },
    });

    if (!authorizationCode) {
      throw new Error("Invalid or expired token");
    }

    return authorizationCode;
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuth2TokenResponse> {
    // Find the client first to get the internal database ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
    });

    if (!client) {
      throw new Error(OAuth2Errors.INVALID_CLIENT);
    }

    const authCode = await this.validateAuthorizationCode(params.code);

    if (!authCode) {
      throw new Error(OAuth2Errors.INVALID_GRANT);
    }

    // Validate PKCE if required
    if (authCode.codeChallenge) {
      if (!params.codeVerifier) {
        throw new Error(OAuth2Errors.INVALID_REQUEST);
      }
      if (
        !this.validatePkceChallenge(
          params.codeVerifier,
          authCode.codeChallenge,
          authCode.codeChallengeMethod || "S256",
        )
      ) {
        throw new Error(OAuth2Errors.INVALID_GRANT);
      }
    }

    // Mark code as used
    await prisma.oAuthAuthorizationCode.update({
      where: { id: authCode.id },
      data: { used: true },
    });

    // Generate access token
    const accessToken = this.generateAccessToken({
      userId: authCode.userId,
      clientId: client.clientId,
      workspaceId: authCode.workspaceId,
      scope: authCode.scope || undefined,
    });

    const refreshToken = this.generateRefreshToken({
      userId: authCode.userId,
      clientId: client.clientId,
      workspaceId: authCode.workspaceId,
    });

    const expiresIn = 86400; // 1 day
    const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const refreshTokenExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ); // 30 days

    // Store tokens
    await prisma.oAuthAccessToken.create({
      data: {
        token: accessToken,
        clientId: client.id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: accessTokenExpiresAt,
        workspaceId: authCode.workspaceId,
      },
    });

    await prisma.oAuthRefreshToken.create({
      data: {
        token: refreshToken,
        clientId: client.id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: refreshTokenExpiresAt,
        workspaceId: authCode.workspaceId,
      },
    });

    const installation = await prisma.oAuthClientInstallation.upsert({
      where: {
        oauthClientId_workspaceId: {
          oauthClientId: client.id,
          workspaceId: authCode.workspaceId,
        },
      },
      update: {
        oauthClientId: client.id,
        workspaceId: authCode.workspaceId,
        installedById: authCode.userId,
        isActive: true,
        grantedScopes: authCode.scope,
      },
      create: {
        oauthClientId: client.id,
        workspaceId: authCode.workspaceId,
        installedById: authCode.userId,
        isActive: true,
        grantedScopes: authCode.scope,
      },
    });

    const idToken = await this.generateIdToken({
      userId: authCode.userId,
      clientId: client.clientId,
      workspaceId: authCode.workspaceId,
      email: authCode.user.email,
      name: authCode.user.name || null,
      avatarUrl: authCode.user.avatarUrl || null,
      installationId: installation.id,
      scopes: authCode.scope?.split(","),
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: authCode.scope || undefined,
      id_token: idToken,
    };
  }

  async getUserInfoFromIdToken(idToken: string): Promise<any> {
    const claims = await this.verifyIdToken(idToken);

    return {
      sub: claims.sub,
      email: claims.email,
      email_verified: claims.email_verified,
      name: claims.name,
      picture: claims.picture,
      installation_id: claims.installation_id,
    };
  }

  // Validate access token
  async validateAccessToken(token: string, scopes?: string[]): Promise<any> {
    const tokenPayload = this.validateTokenFormat(token, "access_token");
    if (!tokenPayload) {
      throw new Error("Invalid or expired token");
    }

    const accessToken = await prisma.oAuthAccessToken.findFirst({
      where: {
        token,
        revoked: false,
        expiresAt: { gt: new Date() },
        userId: tokenPayload.user_id,
        workspaceId: tokenPayload.workspace_id,
      },
      include: {
        client: true,
        user: true,
      },
    });

    // Validate scopes separately if requested
    if (scopes && accessToken) {
      const tokenScopes =
        accessToken.scope?.split(",").map((s) => s.trim()) || [];

      const hasAllScopes = scopes.some((requiredScope) =>
        tokenScopes.some((tokenScope) => tokenScope === requiredScope),
      );

      if (!hasAllScopes) {
        throw new Error("Insufficient scope");
      }
    }

    if (!accessToken) {
      throw new Error("Invalid or expired token");
    }

    return accessToken;
  }

  // Get user info from access token
  async getUserInfo(token: string): Promise<any> {
    const accessToken = await this.validateAccessToken(token);

    return {
      sub: accessToken.user.id,
      email: accessToken.user.email,
      name: accessToken.user.name,
      display_name: accessToken.user.displayName,
      avatar_url: accessToken.user.avatarUrl,
      email_verified: true,
    };
  }

  async validateRefreshToken(token: string): Promise<any> {
    const tokenPayload = await this.validateTokenFormat(token, "refresh_token");
    if (!tokenPayload) {
      throw new Error("Invalid or expired token");
    }

    const refreshToken = await prisma.oAuthRefreshToken.findFirst({
      where: {
        token,
        clientId: tokenPayload.client_id,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!refreshToken) {
      throw new Error("Invalid or expired token");
    }

    return refreshToken;
  }

  // Refresh access token
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
  ): Promise<OAuth2TokenResponse> {
    // Find the client first to get the internal database ID
    const client = await prisma.oAuthClient.findUnique({
      where: { clientId },
    });

    if (!client) {
      throw new Error(OAuth2Errors.INVALID_CLIENT);
    }

    const storedRefreshToken = await prisma.oAuthRefreshToken.findFirst({
      where: {
        token: refreshToken,
        clientId: client.id,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      include: {
        client: true,
        user: true,
      },
    });

    if (!storedRefreshToken) {
      throw new Error(OAuth2Errors.INVALID_GRANT);
    }

    const newRefreshToken = this.generateRefreshToken({
      userId: storedRefreshToken.userId,
      clientId: client.clientId,
      workspaceId: storedRefreshToken.workspaceId,
    });

    // Generate new access token
    const accessToken = this.generateAccessToken({
      userId: storedRefreshToken.userId,
      clientId: client.clientId,
      workspaceId: storedRefreshToken.workspaceId,
      scope: storedRefreshToken.scope || undefined,
    });
    const expiresIn = 86400; // 1 day
    const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const newRefreshTokenExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );

    await prisma.oAuthRefreshToken.create({
      data: {
        token: newRefreshToken,
        clientId: client.id,
        userId: storedRefreshToken.userId,
        scope: storedRefreshToken.scope,
        expiresAt: newRefreshTokenExpiresAt,
        workspaceId: storedRefreshToken.workspaceId,
      },
    });

    await prisma.oAuthAccessToken.create({
      data: {
        token: accessToken,
        clientId: client.id,
        userId: storedRefreshToken.userId,
        scope: storedRefreshToken.scope,
        expiresAt: accessTokenExpiresAt,
        workspaceId: storedRefreshToken.workspaceId,
      },
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: storedRefreshToken.scope || undefined,
    };
  }

  async getClientForCode(code: string) {
    const oAuthCode = await prisma.oAuthAuthorizationCode.findUnique({
      where: {
        code,
      },
      include: {
        client: true,
      },
    });

    return {
      client_id: oAuthCode?.client.clientId,
      client_secret: oAuthCode?.client.clientSecret,
    };
  }

  async createDynamicClient(params: {
    name: string;
    redirectUris: string[];
    grantTypes?: string[];
    clientType?: string;
    responseTypes?: string[];
    requirePkce?: boolean;
    allowedScopes?: string;
    description?: string;
    workspaceId?: string;
    createdById?: string;
  }) {
    // Generate secure client credentials
    const clientId = crypto.randomBytes(16).toString("hex");
    const clientSecret = crypto.randomBytes(32).toString("hex");

    // Default values for MCP clients
    const grantTypes = params.grantTypes || [
      "authorization_code",
      "refresh_token",
    ];
    const allowedScopes = params.allowedScopes || "mcp";
    const requirePkce = params.requirePkce ?? true; // Default to true for security

    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecret,
        name: params.name,
        description:
          params.description ||
          `Dynamically registered ${params.clientType || "client"}`,
        redirectUris: params.redirectUris.join(","),
        grantTypes: grantTypes.join(","),
        allowedScopes,
        requirePkce,
        clientType: "mcp",
        isActive: true,
      },
    });

    return client;
  }
}

export const oauth2Service = new OAuth2Service();
