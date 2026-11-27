import { getCloudflareClient } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_token } = data;

  const client = getCloudflareClient(api_token);

  // Verify the token and retrieve the associated user/account info
  const verifyResponse = await client.get('/user/tokens/verify');
  const tokenInfo = verifyResponse.data?.result;

  if (!tokenInfo || tokenInfo.status !== 'active') {
    throw new Error('Cloudflare API token is invalid or inactive');
  }

  // Fetch the user account to use as account identifier
  const userResponse = await client.get('/user');
  const user = userResponse.data?.result;

  return [
    {
      type: 'account',
      data: {
        settings: {
          email: user?.email ?? '',
          name: user?.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : '',
          token_id: tokenInfo.id,
          token_name: tokenInfo.name,
        },
        accountId: `cloudflare-${user?.id ?? tokenInfo.id}`,
        config: {
          api_token,
        },
      },
    },
  ];
}
