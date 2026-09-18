import axios from 'axios';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;
  const accessToken = oauthResponse.access_token;

  const userResponse = await axios.get(`${META_API_BASE}/me`, {
    params: {
      access_token: accessToken,
      fields: 'id,name,email',
    },
  });

  const user = userResponse.data;

  const integrationConfiguration = {
    access_token: accessToken,
    token_type: oauthResponse.token_type || 'Bearer',
    scope: oauthResponse.scope,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };

  return [
    {
      type: 'account',
      data: {
        settings: {
          userName: user.name,
          userEmail: user.email,
        },
        accountId: user.id,
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: accessToken } },
        },
      },
    },
  ];
}
