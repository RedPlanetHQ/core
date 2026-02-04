import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch user information using the access token
  let userEmail = null;
  let userId = null;
  let portalId = null;
  let hubDomain = null;

  try {
    // Get access token info to retrieve portal ID
    const tokenInfoResponse = await axios.get(
      `https://api.hubapi.com/oauth/v1/access-tokens/${oauthResponse.access_token}`
    );

    userId = tokenInfoResponse.data.user_id;
    hubDomain = tokenInfoResponse.data.hub_domain;
    portalId = tokenInfoResponse.data.hub_id;

    // Get user details
    try {
      const userResponse = await axios.get(`https://api.hubapi.com/settings/v3/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${oauthResponse.access_token}`,
        },
      });

      userEmail = userResponse.data.email;
    } catch (error) {
      console.error('Error fetching user details:', error);
    }
  } catch (error) {
    console.error('Error fetching token info:', error);
  }

  // For HubSpot OAuth2, we need to store the tokens and user info
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
    portalId: portalId,
    hubDomain: hubDomain,
    redirect_uri: oauthParams.redirect_uri || null,
  };

  const payload = {
    settings: {},
    accountId:
      integrationConfiguration.portalId ||
      integrationConfiguration.userEmail ||
      integrationConfiguration.userId,
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
