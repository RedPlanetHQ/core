import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch user information using the access token from Zoho
  let userEmail = null;
  let userId = null;
  let displayName = null;

  try {
    // Zoho Mail API endpoint to get user info
    const userInfoResponse = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        Authorization: `Zoho-oauthtoken ${oauthResponse.access_token}`,
      },
    });

    const accountData = userInfoResponse.data.data?.[0];
    if (accountData) {
      userEmail = accountData.primaryEmailAddress || accountData.accountName;
      userId = accountData.accountId;
      displayName = accountData.displayName;
    }
  } catch (error) {
    console.error('Error fetching Zoho Mail user info:', error);
  }

  // For Zoho Mail OAuth2, we need to store the tokens and user info
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
    displayName: displayName,
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
