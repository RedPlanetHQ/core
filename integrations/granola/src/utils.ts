import axios from 'axios';

const GRANOLA_USERINFO_URL = 'https://mcp-auth.granola.ai/oauth2/userinfo';
const GRANOLA_TOKEN_URL = 'https://mcp-auth.granola.ai/oauth2/token';

export async function getGranolaUserInfo(
  access_token: string,
): Promise<{ email: string; sub: string }> {
  const response = await axios.get(GRANOLA_USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return response.data;
}

async function refreshAccessToken(
  refresh_token: string,
  client_id: string,
  client_secret?: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token,
    client_id,
  };
  if (client_secret) body.client_secret = client_secret;

  const response = await axios.post(GRANOLA_TOKEN_URL, new URLSearchParams(body), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in: response.data.expires_in,
  };
}

// Refresh the access token if expired or within 60s of expiry. Mutates `config`
// in place. The new token is NOT persisted — callers run with a per-request
// snapshot of config, so we re-refresh whenever the stored token is stale.
export async function ensureFreshToken(config: Record<string, any>): Promise<void> {
  if (!config.refresh_token || !config.client_id) return;

  const expiresAt = config.expires_at ? parseInt(config.expires_at, 10) : 0;
  if (expiresAt && Date.now() < expiresAt - 60_000) return;

  const tokens = await refreshAccessToken(
    config.refresh_token,
    config.client_id,
    config.client_secret,
  );

  config.access_token = tokens.access_token;
  config.mcp = { ...(config.mcp || {}), tokens: { access_token: tokens.access_token } };
  if (tokens.refresh_token) config.refresh_token = tokens.refresh_token;
  if (tokens.expires_in) {
    config.expires_at = String(Date.now() + tokens.expires_in * 1000);
  }
}

