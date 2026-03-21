import axios from 'axios';

export interface GAConfig {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  token_type?: string;
  expires_in?: string;
  expires_at?: string;
  scope?: string;
  redirect_uri?: string;
}

const GA4_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Refresh the access token using the stored refresh token.
 */
async function refreshAccessToken(config: GAConfig): Promise<string> {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token as string;
}

/**
 * Return a valid access token, refreshing if expired or close to expiry.
 */
async function getAccessToken(config: GAConfig): Promise<string> {
  if (config.expires_at) {
    const expiresAt =
      typeof config.expires_at === 'string' ? parseInt(config.expires_at, 10) : config.expires_at;
    const nowMs = Date.now();
    // Refresh if token expires within 60 seconds
    if (expiresAt - nowMs < 60_000) {
      return refreshAccessToken(config);
    }
  }
  return config.access_token;
}

/**
 * Make a GET request against the GA4 Data or Admin API.
 */
export async function gaGet(
  url: string,
  config: GAConfig,
  params?: Record<string, string>
): Promise<unknown> {
  const token = await getAccessToken(config);
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}

/**
 * Make a POST request against the GA4 Data or Admin API.
 */
export async function gaPost(url: string, config: GAConfig, body: unknown): Promise<unknown> {
  const token = await getAccessToken(config);
  const res = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

export { GA4_DATA_BASE, GA4_ADMIN_BASE };
