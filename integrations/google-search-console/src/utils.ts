import { OAuth2Client } from 'google-auth-library';
import { google, searchconsole_v1 } from 'googleapis';

export interface GSCConfig {
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

export function getOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  config: GSCConfig
): OAuth2Client {
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    expiry_date:
      typeof config.expires_at === 'string' ? parseInt(config.expires_at) : config.expires_at,
    token_type: config.token_type,
    scope: config.scope,
  });
  return oauth2Client;
}

export function getSearchConsoleClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  config: GSCConfig
): searchconsole_v1.Searchconsole {
  const auth = getOAuth2Client(clientId, clientSecret, redirectUri, config);
  return google.searchconsole({ version: 'v1', auth });
}

/**
 * Exponential backoff for API calls that may return 429.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      const error = err as { response?: { status?: number }; message?: string };
      const status = error?.response?.status;
      if (status === 429 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`Rate limited (429). Retrying in ${delay}ms... (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}
