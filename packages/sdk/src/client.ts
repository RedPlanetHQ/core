import { randomUUID } from "node:crypto";

import type {
  IngestInput,
  IngestResponse,
  SearchInput,
  SearchResponse,
  MeResponse,
  GetIntegrationsConnectedResponse,
  GetIntegrationActionsInput,
  GetIntegrationActionsResponse,
  ExecuteIntegrationActionInput,
  ExecuteIntegrationActionResponse,
  GetDocumentsInput,
  GetDocumentsResponse,
  GetDocumentInput,
  GetDocumentResponse,
  GetGatewaysResponse,
  ExecuteGatewayInput,
  ExecuteGatewayToolInput,
  ExecuteGatewayResponse,
  IntegrationExplorerInput,
  IntegrationExplorerResponse,
  AuthorizationCodeResponse,
  TokenExchangeInput,
  TokenExchangeResponse,
} from "./schemas";

export interface CoreClientOptions {
  baseUrl: string;
  token: string;
}

export class CoreClientError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CoreClientError";
    this.statusCode = statusCode;
  }
}

export class CoreClient {
  private baseUrl: string;
  private token: string;

  constructor(options: CoreClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options?: { body?: unknown; searchParams?: Record<string, string> },
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (options?.searchParams) {
      const params = new URLSearchParams(options.searchParams);
      const query = params.toString();
      if (query) url += `?${query}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || JSON.stringify(errorBody);
      } catch {
        errorMessage = await response.text();
      }
      throw new CoreClientError(errorMessage, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Send a request without an Authorization header.
   * Used for public endpoints like authorization-code and token exchange.
   */
  private async requestPublic<T>(
    method: "GET" | "POST",
    path: string,
    options?: { body?: unknown },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || JSON.stringify(errorBody);
      } catch {
        errorMessage = await response.text();
      }
      throw new CoreClientError(errorMessage, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get the authenticated user's profile info.
   * GET /api/v1/me
   */
  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/api/v1/me");
  }

  /**
   * Store a conversation or document in memory.
   * POST /api/v1/add
   */
  async ingest(body: IngestInput): Promise<IngestResponse> {
    return this.request<IngestResponse>("POST", "/api/v1/add", { body });
  }

  /**
   * Search memory with a query and optional filters.
   * POST /api/v1/search
   */
  async search(body: SearchInput): Promise<SearchResponse> {
    return this.request<SearchResponse>("POST", "/api/v1/search", { body });
  }

  /**
   * List all connected integration accounts for the workspace.
   * GET /api/v1/integration_account
   */
  async getIntegrationsConnected(): Promise<GetIntegrationsConnectedResponse> {
    return this.request<GetIntegrationsConnectedResponse>(
      "GET",
      "/api/v1/integration_account",
    );
  }

  /**
   * Get relevant actions for a specific integration account.
   * GET /api/v1/integration_account/:accountId/action?query=...
   */
  async getIntegrationActions(
    params: GetIntegrationActionsInput,
  ): Promise<GetIntegrationActionsResponse> {
    const searchParams: Record<string, string> = {};
    if (params.query) searchParams.query = params.query;

    return this.request<GetIntegrationActionsResponse>(
      "GET",
      `/api/v1/integration_account/${params.accountId}/action`,
      { searchParams: Object.keys(searchParams).length > 0 ? searchParams : undefined },
    );
  }

  /**
   * Execute an action on an integration account.
   * POST /api/v1/integration_account/:accountId/action
   */
  async executeIntegrationAction(
    params: ExecuteIntegrationActionInput,
  ): Promise<ExecuteIntegrationActionResponse> {
    const { accountId, ...body } = params;

    return this.request<ExecuteIntegrationActionResponse>(
      "POST",
      `/api/v1/integration_account/${accountId}/action`,
      { body },
    );
  }

  /**
   * Generate a new session UUID for conversation tracking.
   * Local operation — no API call.
   */
  async getSessionId(): Promise<string> {
    return randomUUID();
  }

  /**
   * List documents with optional filtering and pagination.
   * GET /api/v1/documents
   */
  async getDocuments(
    params?: GetDocumentsInput,
  ): Promise<GetDocumentsResponse> {
    const searchParams: Record<string, string> = {};

    if (params) {
      if (params.page != null) searchParams.page = String(params.page);
      if (params.limit != null) searchParams.limit = String(params.limit);
      if (params.source) searchParams.source = params.source;
      if (params.status) searchParams.status = params.status;
      if (params.type) searchParams.type = params.type;
      if (params.sessionId) searchParams.sessionId = params.sessionId;
      if (params.label) searchParams.label = params.label;
      if (params.cursor) searchParams.cursor = params.cursor;
    }

    return this.request<GetDocumentsResponse>("GET", "/api/v1/documents", {
      searchParams:
        Object.keys(searchParams).length > 0 ? searchParams : undefined,
    });
  }

  /**
   * Get a single document by ID.
   * GET /api/v1/documents/:documentId
   */
  async getDocument(
    params: GetDocumentInput,
  ): Promise<GetDocumentResponse> {
    return this.request<GetDocumentResponse>(
      "GET",
      `/api/v1/documents/${params.documentId}`,
    );
  }

  /**
   * List all connected gateways for the workspace.
   * GET /api/v1/gateways
   */
  async getGateways(): Promise<GetGatewaysResponse> {
    return this.request<GetGatewaysResponse>("GET", "/api/v1/gateways");
  }

  /**
   * Run a gateway sub-agent with an intent and return the final text result.
   * POST /api/v1/gateways/:gatewayId/execute
   */
  async executeGateway(
    params: ExecuteGatewayInput,
  ): Promise<ExecuteGatewayResponse> {
    return this.request<ExecuteGatewayResponse>(
      "POST",
      `/api/v1/gateways/${params.gatewayId}/execute`,
      { body: { intent: params.intent } },
    );
  }

  /**
   * Proxy a single tool call to a gateway via server websocket.
   * POST /api/v1/gateways/:gatewayId/execute  (mode: "tool")
   */
  async executeGatewayTool(
    params: ExecuteGatewayToolInput,
  ): Promise<ExecuteGatewayResponse> {
    return this.request<ExecuteGatewayResponse>(
      "POST",
      `/api/v1/gateways/${params.gatewayId}/execute`,
      { body: { mode: "tool", toolName: params.toolName, params: params.params } },
    );
  }

  /**
   * Run the integration explorer for a query and return the final text result.
   * POST /api/v1/integration-explorer
   */
  async runIntegrationExplorer(
    params: IntegrationExplorerInput,
  ): Promise<IntegrationExplorerResponse> {
    return this.request<IntegrationExplorerResponse>(
      "POST",
      "/api/v1/integration-explorer",
      { body: params },
    );
  }

  // -------------------------------------------------------------------------
  // Auth – Device-style login flow (public endpoints, no token required)
  // -------------------------------------------------------------------------

  /**
   * Request a fresh authorization code.
   * POST /api/v1/authorization-code  (unauthenticated)
   *
   * The returned `url` is the page the user must visit to authorize the CLI.
   */
  async getAuthorizationCode(): Promise<AuthorizationCodeResponse> {
    return this.requestPublic<AuthorizationCodeResponse>(
      "POST",
      "/api/v1/authorization-code",
    );
  }

  /**
   * Exchange an authorization code for a personal access token.
   * POST /api/v1/token  (unauthenticated)
   *
   * Returns `{ token: null }` while the user has not yet completed
   * the browser authorization step.  Poll until `token` is non-null.
   */
  async exchangeToken(
    params: TokenExchangeInput,
  ): Promise<TokenExchangeResponse> {
    return this.requestPublic<TokenExchangeResponse>(
      "POST",
      "/api/v1/token",
      { body: params },
    );
  }

  /**
   * Verify that the current token is valid by calling /api/v1/me.
   * Returns the user profile on success, or throws CoreClientError on failure.
   * Useful as a health-check before launching other operations.
   */
  async checkAuth(): Promise<MeResponse> {
    return this.me();
  }
}
