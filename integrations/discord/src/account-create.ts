import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch user information using the access token
  let username = null;
  let userId = null;
  let discriminator = null;
  let avatar = null;
  let email = null;

  try {
    // Get user info from Discord API
    const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
      },
    });

    userId = userResponse.data.id;
    username = userResponse.data.username;
    discriminator = userResponse.data.discriminator;
    avatar = userResponse.data.avatar;
    email = userResponse.data.email;
  } catch (error) {
    console.error('Error fetching user info:', error);
  }

  // Get guilds (servers) the user is in
  let guilds = [];
  try {
    const guildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
      },
    });

    guilds = guildsResponse.data;
  } catch (error) {
    console.error('Error fetching guilds:', error);
  }

  // For Discord OAuth2, we need to store the tokens and user info
  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    client_id: oauthResponse.client_id,
    client_secret: oauthResponse.client_secret,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    username: username,
    userId: userId,
    discriminator: discriminator,
    avatar: avatar,
    email: email,
    guilds: guilds,
    redirect_uri: oauthParams.redirect_uri || null,
  };

  const payload = {
    settings: {},
    accountId: integrationConfiguration.userId || integrationConfiguration.username,
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
