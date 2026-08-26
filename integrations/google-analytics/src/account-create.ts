import axios from 'axios';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface PropertySummary {
  id: string;
  displayName: string;
  accountId: string;
  accountDisplayName: string;
}

async function fetchAccountSummaries(
  accessToken: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<PropertySummary[]> {
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri || '');
  oauth2Client.setCredentials({ access_token: accessToken });

  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client });

  try {
    const res = await admin.accountSummaries.list({ pageSize: 200 });
    const summaries = res.data.accountSummaries ?? [];

    const properties: PropertySummary[] = [];
    for (const account of summaries) {
      const accountId = account.account?.replace('accounts/', '') ?? '';
      const accountDisplayName = account.displayName ?? '';
      for (const prop of account.propertySummaries ?? []) {
        const propertyId = prop.property?.replace('properties/', '') ?? '';
        if (propertyId) {
          properties.push({
            id: propertyId,
            displayName: prop.displayName ?? propertyId,
            accountId,
            accountDisplayName,
          });
        }
      }
    }
    return properties;
  } catch (error) {
    console.error('Error fetching GA4 account summaries:', error);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function integrationCreate(data: any) {
  const { oauthResponse, oauthParams } = data;

  let userEmail: string | null = null;
  let userId: string | null = null;

  try {
    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
      },
    });
    userEmail = userInfoResponse.data.email;
    userId = userInfoResponse.data.id;
  } catch (error) {
    console.error('Error fetching user info:', error);
  }

  // Fetch GA4 properties so we can store a default and the full list
  const availableProperties = await fetchAccountSummaries(
    oauthResponse.access_token,
    oauthResponse.client_id ?? '',
    oauthResponse.client_secret ?? '',
    oauthParams?.redirect_uri ?? ''
  );

  const defaultPropertyId = availableProperties.length > 0 ? availableProperties[0].id : null;

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    client_id: oauthResponse.client_id,
    client_secret: oauthResponse.client_secret,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    redirect_uri: oauthParams?.redirect_uri ?? null,
    userEmail,
    userId,
    defaultPropertyId,
    availableProperties,
  };

  const payload = {
    settings: {},
    accountId: integrationConfiguration.userEmail || integrationConfiguration.userId,
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
