import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse, oauthParams } = data;

  // Fetch Spotify user profile using the access token
  let userEmail: string | null = null;
  let userId: string | null = null;
  let displayName: string | null = null;

  try {
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${oauthResponse.access_token}`,
      },
    });
    userEmail = profileResponse.data.email;
    userId = profileResponse.data.id;
    displayName = profileResponse.data.display_name;
  } catch (error) {
    console.error('Error fetching Spotify user profile:', error);
  }

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    userEmail,
    userId,
    displayName,
    redirect_uri: oauthParams?.redirect_uri || null,
  };

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId: userEmail || userId || 'spotify',
        config: integrationConfiguration,
      },
    },
  ];
}
