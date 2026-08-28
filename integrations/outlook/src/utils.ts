import axios, { AxiosInstance } from 'axios';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

export interface OutlookConfig {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  redirect_uri?: string;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(config: OutlookConfig): Promise<string> {
  try {
    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: config.client_id,
        client_secret: config.client_secret,
        refresh_token: config.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/.default offline_access',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
}

/**
 * Create an authenticated Microsoft Graph API client
 */
export function createGraphClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: GRAPH_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Get an authenticated Graph client, refreshing the token if needed
 */
export async function getGraphClient(config: OutlookConfig): Promise<AxiosInstance> {
  let accessToken = config.access_token;

  try {
    // Test current token
    await axios.get(`${GRAPH_BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Token expired, refresh it
    accessToken = await refreshAccessToken(config);
  }

  return createGraphClient(accessToken);
}

/**
 * Parse email body content
 */
export function parseEmailBody(body: { contentType: string; content: string }): string {
  if (!body || !body.content) return '';
  return body.content;
}

/**
 * Format email sender for display
 */
export function formatEmailSender(from: {
  emailAddress: { name: string; address: string };
}): string {
  if (!from || !from.emailAddress) return 'Unknown';
  const { name, address } = from.emailAddress;
  return name ? `${name} <${address}>` : address;
}
