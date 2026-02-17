import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  discoverOAuthMetadata,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Stored OAuth credentials for a custom MCP integration
 */
export interface CustomMcpStoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Token provider for custom MCP integrations with automatic refresh support.
 * Use this when you have stored OAuth credentials and want to create a client.
 */
export class CustomMcpTokenProvider implements OAuthClientProvider {
  private _tokens: OAuthTokens;
  private _clientInformation?: OAuthClientInformationFull;
  private _serverUrl: string;

  constructor(
    serverUrl: string,
    credentials: CustomMcpStoredCredentials,
    private readonly _onTokensRefreshed?: (
      newCredentials: CustomMcpStoredCredentials
    ) => Promise<void>
  ) {
    this._serverUrl = serverUrl;
    this._tokens = {
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      expires_in: credentials.expiresIn,
      token_type: "Bearer",
    };

    if (credentials.clientId) {
      this._clientInformation = {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      } as OAuthClientInformationFull;
    }
  }

  get redirectUrl(): string {
    return "";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Core MCP Client",
      redirect_uris: [],
      grant_types: ["refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this._clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens;

    // Notify about new tokens if callback provided
    if (this._onTokensRefreshed) {
      await this._onTokensRefreshed({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token as string,
        expiresIn: tokens.expires_in as number,
        clientId: this._clientInformation?.client_id as string,
        clientSecret: this._clientInformation?.client_secret as string,
      });
    }
  }

  redirectToAuthorization(_authorizationUrl: URL): void {
    // Not used for token-based auth
  }

  saveCodeVerifier(_codeVerifier: string): void {
    // Not used for token-based auth
  }

  codeVerifier(): string {
    return "";
  }

  /**
   * Attempt to refresh the access token using the refresh token
   */
  async refreshTokens(): Promise<boolean> {
    if (!this._tokens.refresh_token) {
      return false;
    }

    try {
      const metadata = await discoverOAuthMetadata(this._serverUrl);

      const newTokens = await refreshAuthorization(this._serverUrl, {
        metadata: metadata as any,
        clientInformation: this._clientInformation as any,
        refreshToken: this._tokens.refresh_token,
      });

      await this.saveTokens(newTokens);
      return true;
    } catch (error) {
      console.error("Failed to refresh tokens:", error);
      return false;
    }
  }
}

/**
 * Create an MCP client connected to a custom MCP server with stored credentials.
 * The client automatically handles token refresh via the auth provider.
 */
export async function createCustomMcpClient(options: {
  serverUrl: string;
  credentials: CustomMcpStoredCredentials;
  onTokensRefreshed?: (newCredentials: CustomMcpStoredCredentials) => Promise<void>;
}): Promise<Client> {
  const { serverUrl, credentials, onTokensRefreshed } = options;

  const authProvider = new CustomMcpTokenProvider(serverUrl, credentials, onTokensRefreshed);

  const client = new Client(
    {
      name: "Core MCP Client",
      version: "1.0.0",
    },
    { capabilities: {} }
  );

  const baseUrl = new URL(serverUrl);
  const transport = new StreamableHTTPClientTransport(baseUrl, {
    authProvider,
  });

  await client.connect(transport as any);

  return client;
}

/**
 * OAuth session data stored during the authorization flow
 */
export interface CustomMcpOAuthSession {
  serverUrl: string;
  redirectUrl: string;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationFull;
  state?: string;
}

/**
 * Result of completing OAuth flow
 */
export interface CustomMcpOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Simple OAuth client provider for custom MCP integrations
 */
export class CustomMcpOAuthProvider implements OAuthClientProvider {
  private _clientInformation?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _authorizationUrl?: URL;

  constructor(
    private readonly _redirectUrl: string,
    private readonly _clientMetadata: OAuthClientMetadata,
    private readonly _onRedirect?: (url: URL) => void
  ) {}

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this._clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this._authorizationUrl = authorizationUrl;
    if (this._onRedirect) {
      this._onRedirect(authorizationUrl);
    }
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error("No code verifier saved");
    }
    return this._codeVerifier;
  }

  // Getters for session data
  getAuthorizationUrl(): URL | undefined {
    return this._authorizationUrl;
  }

  getSessionData(): CustomMcpOAuthSession {
    return {
      serverUrl: "",
      redirectUrl: this._redirectUrl,
      codeVerifier: this._codeVerifier,
      clientInformation: this._clientInformation,
    } as any;
  }

  // Restore session data
  restoreSessionData(session: Partial<CustomMcpOAuthSession>): void {
    if (session.codeVerifier) {
      this._codeVerifier = session.codeVerifier;
    }
    if (session.clientInformation) {
      this._clientInformation = session.clientInformation;
    }
  }
}

/**
 * Get authorization URL for custom MCP server
 */
export async function getCustomMcpAuthorizationUrl(options: {
  serverUrl: string;
  redirectUrl: string;
  clientName?: string;
}): Promise<{
  authUrl: string;
  sessionData: CustomMcpOAuthSession;
}> {
  const { serverUrl, redirectUrl, clientName = "Core MCP Client" } = options;

  const clientMetadata: OAuthClientMetadata = {
    client_name: clientName,
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };

  let capturedAuthUrl: URL | undefined;

  const oauthProvider = new CustomMcpOAuthProvider(redirectUrl, clientMetadata, (url: URL) => {
    capturedAuthUrl = url;
  });

  const client = new Client(
    {
      name: clientName,
      version: "1.0.0",
    },
    { capabilities: {} }
  );

  const baseUrl = new URL(serverUrl);
  const transport = new StreamableHTTPClientTransport(baseUrl, {
    authProvider: oauthProvider,
  });

  try {
    // This will trigger OAuth redirect
    await client.connect(transport as any);
    // If we get here without error, server doesn't require auth
    throw new Error("Server does not require OAuth authentication");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      // OAuth redirect was triggered
      if (!capturedAuthUrl) {
        throw new Error("Failed to capture authorization URL");
      }

      const sessionData: CustomMcpOAuthSession = {
        serverUrl,
        redirectUrl,
        codeVerifier: oauthProvider.codeVerifier(),
        clientInformation: oauthProvider.clientInformation(),
      } as any;

      return {
        authUrl: capturedAuthUrl.toString(),
        sessionData,
      };
    }
    throw error;
  }
}

/**
 * Complete OAuth flow with authorization code
 */
export async function completeCustomMcpOAuth(options: {
  serverUrl: string;
  redirectUrl: string;
  authorizationCode: string;
  sessionData: CustomMcpOAuthSession;
  clientName?: string;
}): Promise<CustomMcpOAuthResult> {
  const {
    serverUrl,
    redirectUrl,
    authorizationCode,
    sessionData,
    clientName = "Core MCP Client",
  } = options;

  const clientMetadata: OAuthClientMetadata = {
    client_name: clientName,
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };

  const oauthProvider = new CustomMcpOAuthProvider(redirectUrl, clientMetadata);

  // Restore session data
  oauthProvider.restoreSessionData(sessionData);

  const baseUrl = new URL(serverUrl);
  const transport = new StreamableHTTPClientTransport(baseUrl, {
    authProvider: oauthProvider,
  });

  // Complete the OAuth flow
  await transport.finishAuth(authorizationCode);

  const tokens = oauthProvider.tokens();
  if (!tokens) {
    throw new Error("Failed to obtain tokens after OAuth completion");
  }

  const clientInfo = oauthProvider.clientInformation();

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token as string,
    expiresIn: tokens.expires_in as number,
    tokenType: tokens.token_type,
    clientId: clientInfo?.client_id as string,
    clientSecret: clientInfo?.client_secret as string,
  };
}
