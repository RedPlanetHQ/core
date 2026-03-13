import axios from 'axios';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
) {
  const { oauthResponse } = data;

  let userId: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let email: string | null = null;

  try {
    const profileResponse = await axios.get(
      'https://api.prod.whoop.com/developer/v1/user/profile/basic',
      {
        headers: {
          Authorization: `Bearer ${oauthResponse.access_token}`,
        },
      }
    );

    userId = String(profileResponse.data.user_id);
    firstName = profileResponse.data.first_name;
    lastName = profileResponse.data.last_name;
    email = profileResponse.data.email;
  } catch (error) {
    console.error('Error fetching Whoop user profile:', error);
  }

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    token_type: oauthResponse.token_type,
    expires_in: oauthResponse.expires_in,
    expires_at: oauthResponse.expires_at,
    scope: oauthResponse.scope,
    userId,
    firstName,
    lastName,
    email,
  };

  const payload = {
    settings: {},
    accountId: userId || email || 'whoop-user',
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
