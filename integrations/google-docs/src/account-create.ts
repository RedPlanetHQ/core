import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  if (data?.service_account_json) {
    return await createServiceAccountIntegration(data.service_account_json);
  }

  return await createOAuthIntegration(data);
}

async function createServiceAccountIntegration(rawJson: string) {
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('service_account_json must be a valid JSON string');
  }

  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      'service_account_json is not a valid Google service account key (expected type=service_account with client_email and private_key)'
    );
  }

  const integrationConfiguration = {
    auth_mode: 'service_account',
    service_account_json: rawJson,
    userEmail: parsed.client_email,
    projectId: parsed.project_id,
  };

  return [
    {
      type: 'account',
      data: {
        settings: { auth_mode: 'service_account' },
        accountId: parsed.client_email,
        config: integrationConfiguration,
      },
    },
  ];
}

async function createOAuthIntegration(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch user information using the access token
  let userEmail = null;
  let userId = null;

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

  const integrationConfiguration = {
    auth_mode: 'oauth',
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    client_id: oauthResponse.client_id,
    client_secret: oauthResponse.client_secret,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    userEmail: userEmail,
    userId: userId,
    redirect_uri: oauthParams.redirect_uri || null,
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
