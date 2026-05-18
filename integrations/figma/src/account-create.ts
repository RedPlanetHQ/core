import axios from 'axios';

/**
 * Called after the OAuth2 Authorization Code flow completes.
 * Fetches the authenticated Figma user and returns account + config records.
 */
export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;

  const integrationConfiguration = {
    access_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
  };

  // Fetch the authenticated user from the Figma REST API.
  const userResponse = await axios.get('https://api.figma.com/v1/me', {
    headers: {
      Authorization: `Bearer ${integrationConfiguration.access_token}`,
    },
  });

  const user = userResponse.data;

  return [
    {
      type: 'account',
      data: {
        settings: {
          handle: user.handle,
          email: user.email,
        },
        accountId: user.id.toString(),
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: integrationConfiguration.access_token } },
        },
      },
    },
  ];
}
