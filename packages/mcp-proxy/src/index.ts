// Export types for compatibility
export * from "./types/index.js";

// MCP Remote Client exports (new simplified interface)
export {
  createMCPAuthClient,
  getDefaultEnvironment,
  MCPAuthenticationClient,
} from "./core/mcp-remote-client.js";

// Custom MCP OAuth utilities
export {
  getCustomMcpAuthorizationUrl,
  completeCustomMcpOAuth,
  createCustomMcpClient,
  CustomMcpOAuthProvider,
  CustomMcpTokenProvider,
  type CustomMcpOAuthSession,
  type CustomMcpOAuthResult,
  type CustomMcpStoredCredentials,
} from "./lib/custom-mcp-oauth.js";

export {
  type MCPRemoteClientConfig,
  type ProxyConnectionConfig,
  type TransportStrategy,
  type StoredCredentials,
  type ProxyCredentials,
  type AuthenticationResult,
  type CredentialSaveCallback,
  type CredentialLoadCallback,
  type OAuthFlowResult,
  type OAuthCallbackData,
  type MCPMessage,
  type MCPResponse,
  type MCPClientError,
  type ConnectionTestResult,
  type ProxyHandlerConfig,
  type TransportConnection,
  type MCPProxyFunction,
} from "./types/remote-client.js";

// Error exports
export {
  MCPAuthProxyError,
  InvalidCredentialsError,
  OAuthError,
  ProxyError,
  TransportError,
} from "./utils/errors.js";

// Transport utilities for Remix/HTTP integration
export { createMCPTransportBridge } from "./utils/index.js";

// Auth provider utilities - can be used independently
export {
  createAuthProvider,
  createAuthProviderForProxy,
  createAuthProviderFromConfig,
  type AuthProviderConfig,
} from "./utils/auth-provider-factory.js";

// Removed createMCPTransportProxy and createSimpleMCPProxy - functionality consolidated into createMCPProxy
