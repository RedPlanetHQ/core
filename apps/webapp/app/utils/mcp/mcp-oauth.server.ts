import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface McpOAuthSession {
  serverUrl: string;
  redirectUrl: string;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationFull;
}

export interface McpOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  clientId?: string;
  clientSecret?: string;
}

class McpOAuthProvider implements OAuthClientProvider {
  private _clientInformation?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _authorizationUrl?: URL;

  constructor(
    private readonly _redirectUrl: string,
    private readonly _clientMetadata: OAuthClientMetadata,
    private readonly _onRedirect?: (url: URL) => void,
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

  saveClientInformation(info: OAuthClientInformationFull): void {
    this._clientInformation = info;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this._authorizationUrl = authorizationUrl;
    this._onRedirect?.(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) throw new Error("No code verifier saved");
    return this._codeVerifier;
  }

  restoreSession(session: Partial<McpOAuthSession>): void {
    if (session.codeVerifier) this._codeVerifier = session.codeVerifier;
    if (session.clientInformation)
      this._clientInformation = session.clientInformation;
  }

  getSessionData(): Pick<
    McpOAuthSession,
    "codeVerifier" | "clientInformation"
  > {
    return {
      codeVerifier: this._codeVerifier,
      clientInformation: this._clientInformation,
    };
  }
}

export async function getMcpAuthorizationUrl(options: {
  serverUrl: string;
  redirectUrl: string;
  clientName?: string;
}): Promise<{ authUrl: string; sessionData: McpOAuthSession }> {
  const { serverUrl, redirectUrl, clientName = "Core MCP Client" } = options;

  const clientMetadata: OAuthClientMetadata = {
    client_name: clientName,
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  };

  let capturedAuthUrl: URL | undefined;

  const provider = new McpOAuthProvider(redirectUrl, clientMetadata, (url) => {
    capturedAuthUrl = url;
  });

  const client = new Client(
    { name: clientName, version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: provider,
  });

  try {
    await client.connect(transport as any);
    throw new Error("Server does not require OAuth authentication");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      if (!capturedAuthUrl)
        throw new Error("Failed to capture authorization URL");

      return {
        authUrl: capturedAuthUrl.toString(),
        sessionData: {
          serverUrl,
          redirectUrl,
          ...provider.getSessionData(),
        },
      };
    }
    throw error;
  }
}

export async function completeMcpOAuth(options: {
  serverUrl: string;
  redirectUrl: string;
  authorizationCode: string;
  sessionData: McpOAuthSession;
  clientName?: string;
}): Promise<McpOAuthResult> {
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

  const provider = new McpOAuthProvider(redirectUrl, clientMetadata);
  provider.restoreSession(sessionData);

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: provider,
  });

  await transport.finishAuth(authorizationCode);

  const tokens = provider.tokens();
  if (!tokens)
    throw new Error("Failed to obtain tokens after OAuth completion");

  const clientInfo = provider.clientInformation();

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token as string,
    expiresIn: tokens.expires_in as number,
    tokenType: tokens.token_type,
    clientId: clientInfo?.client_id as string,
    clientSecret: clientInfo?.client_secret as string,
  };
}
