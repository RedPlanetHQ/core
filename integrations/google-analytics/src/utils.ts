import { OAuth2Client } from 'google-auth-library';
import { google, analyticsdata_v1beta, analyticsadmin_v1beta } from 'googleapis';

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
  userEmail?: string;
  defaultPropertyId?: string | null;
  availableProperties?: Array<{
    id: string;
    displayName: string;
    accountId: string;
    accountDisplayName: string;
  }>;
}

export function getOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  config: GAConfig
): OAuth2Client {
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    expiry_date:
      typeof config.expires_at === 'string' ? parseInt(config.expires_at) : undefined,
    token_type: config.token_type,
    scope: config.scope,
  });
  return oauth2Client;
}

export function getDataClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  config: GAConfig
): analyticsdata_v1beta.Analyticsdata {
  const auth = getOAuth2Client(clientId, clientSecret, redirectUri, config);
  return google.analyticsdata({ version: 'v1beta', auth });
}

export function getAdminClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  config: GAConfig
): analyticsadmin_v1beta.Analyticsadmin {
  const auth = getOAuth2Client(clientId, clientSecret, redirectUri, config);
  return google.analyticsadmin({ version: 'v1beta', auth });
}

/**
 * Resolve the property ID to use for a request.
 * Prefers an explicitly passed propertyId; falls back to the stored default.
 */
export function resolvePropertyId(
  explicitPropertyId: string | undefined | null,
  config: GAConfig
): string | null {
  return explicitPropertyId ?? config.defaultPropertyId ?? null;
}

/**
 * Exponential backoff for API calls that may return 429 or 5xx.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelayMs = 1000
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      const error = err as { response?: { status?: number }; message?: string };
      const status = error?.response?.status;
      if ((status === 429 || (status !== undefined && status >= 500)) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`API error ${status}. Retrying in ${delay}ms... (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}
