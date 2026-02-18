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

  const user = await getLinkedInData(
    'https://api.linkedin.com/v2/me',
    integrationConfiguration.access_token,
  );

  return [
    {
      type: 'account',
      data: {
        settings: {
          firstName: user.localizedFirstName,
          lastName: user.localizedLastName,
          id: user.id,
          schedule: {
            frequency: '*/15 * * * *',
          },
        },
        accountId: user.id,
        config: {
          ...integrationConfiguration,
          mcp: { tokens: { access_token: integrationConfiguration.access_token } },
        },
      },
    },
  ];
}
