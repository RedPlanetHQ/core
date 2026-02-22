import { getCodebergData } from './utils';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;
  const integrationConfiguration = {
    refresh_token: oauthResponse.refresh_token,
    access_token: oauthResponse.access_token,
  };

  const user = await getCodebergData(
    'https://codeberg.org/api/v1/user',
    integrationConfiguration.access_token,
  );

  return [
    {
      type: 'account',
      data: {
        settings: {
          login: user.login,
          username: user.login,
          schedule: {
            frequency: '*/15 * * * *',
          },
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
