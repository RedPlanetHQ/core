import axios from 'axios';

export async function integrationCreate(
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

  // For Google Tasks OAuth2, we need to store the tokens and user info
  const integrationConfiguration = {
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
