import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MCPRemoteClientConfig, AuthenticationResult } from "../types/remote-client.js";
import { MCPAuthProxyError } from "../utils/errors.js";
import { NodeOAuthClientProvider } from "../lib/node-oauth-client-provider.js";
import { globalAuthStorage } from "../lib/in-memory-auth-storage.js";
import { getServerUrlHash } from "../lib/utils.js";
import { createAuthProviderFromConfig } from "../utils/auth-provider-factory.js";

/**
 * Creates an MCP authentication client that handles OAuth flow
 * @param config Configuration for the MCP service
 * @param onCredentialSave Callback to save credentials to your database
 * @returns Authentication client with OAuth capabilities
 */
export function createMCPAuthClient(config: MCPRemoteClientConfig): MCPAuthenticationClient {
  return new MCPAuthenticationClient(config);
}

/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
export function getDefaultEnvironment(): Record<string, string> {
  const DEFAULT_INHERITED_ENV_VARS =
    process.platform === "win32"
      ? [
          "APPDATA",
          "HOMEDRIVE",
          "HOMEPATH",
          "LOCALAPPDATA",
          "PATH",
          "PROCESSOR_ARCHITECTURE",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "USERNAME",
          "USERPROFILE",
        ]
      : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

  const env: Record<string, string> = {};

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      continue;
    }

    if (value.startsWith("()")) {
      // Skip functions, which are a security risk.
      continue;
    }

    env[key] = value;
  }

  return env;
}

export class MCPAuthenticationClient {
  private serverUrlHash: string;
  private authProvider: NodeOAuthClientProvider | null = null;
  private client: Client | null = null;

  constructor(private config: MCPRemoteClientConfig) {
    this.serverUrlHash = getServerUrlHash(config.serverUrl);

    // Validate configuration
    this.validateConfig();
  }

  /**
   * Gets the auth provider instance, creating it if needed
   * This method can be called independently to get auth provider for other uses
   */
  getAuthProvider(): NodeOAuthClientProvider {
    if (!this.authProvider) {
      this.authProvider = createAuthProviderFromConfig(this.config);
    }
    return this.authProvider;
  }

  private validateConfig(): void {
    if (!this.config.serverUrl) {
      throw new MCPAuthProxyError("Server URL is required", "INVALID_CONFIG");
    }

    const url = new URL(this.config.serverUrl);
    const isLocalhost =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:";

    if (!(url.protocol === "https:" || isLocalhost)) {
      throw new MCPAuthProxyError("Only HTTPS URLs are allowed (except localhost)", "INVALID_URL");
    }
  }

  /**
   * Gets authorization URL for OAuth flow (alternative to initiateAuth)
   * @param options OAuth options
   * @returns Authorization URL string
   */
  async getAuthorizationURL(
    options: {
      scope?: string;
      resourceMetadataUrl?: string;
    } = {}
  ): Promise<{ authUrl: string; state: string }> {
    try {
      const authProvider = this.getAuthProvider();
      return await authProvider.authorizationURL(options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MCPAuthProxyError(
        `Failed to get authorization URL: ${errorMessage}`,
        "AUTH_URL_FAILED"
      );
    }
  }

  /**
   * Completes OAuth flow with authorization code
   * Supports both new persistent flow and legacy state validation
   * @param options OAuth completion options
   * @returns Success status
   */
  async completeOAuthFlow(options: {
    authorizationCode: string;
    state?: string;
    scope?: string;
    resourceMetadataUrl?: string;
  }): Promise<AuthenticationResult> {
    try {
      const authProvider = this.getAuthProvider();

      // State validation (if state is provided - for backward compatibility)
      // if (options.state) {
      //   const providerState = authProvider.state?.() || "";
      //   if (options.state !== providerState) {
      //     throw new OAuthError("Invalid state parameter - possible CSRF attack");
      //   }
      // }

      // Use the NodeOAuthClientProvider's completeAuth method
      await authProvider.completeAuth({
        authorizationCode: options.authorizationCode,
        ...(options.scope && { scope: options.scope }),
        ...(options.resourceMetadataUrl && {
          resourceMetadataUrl: options.resourceMetadataUrl,
        }),
      });

      // Get the saved tokens and client info
      const tokens = await authProvider.tokens();
      if (!tokens) {
        throw new MCPAuthProxyError("No tokens available after OAuth completion", "TOKENS_MISSING");
      }

      const clientInfo = await authProvider.clientInformation();
      const codeVerifier = await authProvider.codeVerifier();

      const storedCredentials = clientInfo
        ? {
            serverUrl: this.config.serverUrl,
            tokens,
            expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
            clientInfo,
            codeVerifier,
          }
        : {};

      // Clear in-memory storage after successful callback
      await globalAuthStorage.clearServerData(this.serverUrlHash);

      return {
        success: true,
        ...storedCredentials,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MCPAuthProxyError(
        `Failed to complete OAuth flow: ${errorMessage}`,
        "OAUTH_COMPLETION_FAILED"
      );
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}
