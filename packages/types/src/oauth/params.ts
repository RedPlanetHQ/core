export class OAuth2Params {
  authorization_url: string;
  authorization_params?: Record<string, string>;
  default_scopes?: string[];
  scope_separator?: string;
  scope_identifier?: string;
  token_url: string;
  token_params?: Record<string, string>;
  redirect_uri_metadata?: string[];
  token_response_metadata?: string[];
  token_expiration_buffer?: number; // In seconds.
  scopes?: string[];
  token_request_auth_method?: string;
}

export type AuthType = "OAuth2" | "api_key" | "mcp";

export type Param = {
  name: string;
  label: string;
  placeholder: string;
  description: string;
};

export declare class APIKeyParams {
  fields: Array<Param>;
}

export declare class McpAuthParams {
  server_url: string;
}
