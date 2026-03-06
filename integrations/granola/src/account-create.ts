import { getGranolaUserInfo } from './utils';

export async function integrationCreate(data: Record<string, any>) {
  const { oauthResponse } = data;
  const { access_token, refresh_token } = oauthResponse;

  const userInfo = await getGranolaUserInfo(access_token);

  return [
    {
      type: 'account',
      data: {
        accountId: userInfo.email,
        config: {
          access_token,
          refresh_token,
          mcp: { tokens: { access_token } },
        },
        settings: { email: userInfo.email },
      },
    },
  ];
}
