import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
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

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    client_id: oauthResponse.client_id,
    client_secret: oauthResponse.client_secret,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    userEmail,
    userId,
    redirect_uri: oauthParams?.redirect_uri || null,
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
