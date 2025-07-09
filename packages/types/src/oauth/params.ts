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
}

export type AuthType = "OAuth2" | "APIKey";

export class APIKeyParams {
  "header_name": string;
  "format": string;
}
