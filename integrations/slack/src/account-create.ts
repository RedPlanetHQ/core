export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;
  const integrationConfiguration = {
    access_token: oauthResponse.authed_user.access_token,
    bot_token: oauthResponse.access_token,
    teamId: oauthResponse.team.id,
    teamName: oauthResponse.team.name,
    userId: oauthResponse.authed_user.id,
    scope: oauthResponse.authed_user.scope,
  };

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId: integrationConfiguration.userId,
        config: integrationConfiguration,
      },
    },
  ];
}
