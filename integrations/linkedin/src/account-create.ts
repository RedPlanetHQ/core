import { getLinkedInData } from './utils';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;
  const integrationConfiguration = {
    refresh_token: oauthResponse.refresh_token,
    access_token: oauthResponse.access_token,
  };

  // Using the modern OIDC userinfo endpoint instead of legacy /v2/me
  const user = await getLinkedInData(
    'https://api.linkedin.com/v2/userinfo',
    integrationConfiguration.access_token,
  );

  return [
    {
      type: 'account',
      data: {
        settings: {
          firstName: user.given_name,
          lastName: user.family_name,
          id: user.sub,
          email: user.email,
          schedule: {
            frequency: '*/15 * * * *',
          },
        },
        accountId: user.sub,
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: integrationConfiguration.access_token } },
        },
      },
    },
  ];
}