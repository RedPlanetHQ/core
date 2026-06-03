import { getGranolaUserInfo } from './utils';

export async function integrationCreate(data: Record<string, any>) {
  const { oauthResponse } = data;
  const { access_token, refresh_token, expires_in, client_id, client_secret } =
    oauthResponse;

  const userInfo = await getGranolaUserInfo(access_token);

  const expires_at = expires_in
    ? String(Date.now() + Number(expires_in) * 1000)
    : undefined;

  return [
    {
      type: 'account',
      data: {
        accountId: userInfo.email,
        config: {
          access_token,
          refresh_token,
          ...(expires_at ? { expires_at } : {}),
          ...(client_id ? { client_id } : {}),
          ...(client_secret ? { client_secret } : {}),
          mcp: { tokens: { access_token } },
        },
        settings: { email: userInfo.email },
      },
    },
  ];
}
