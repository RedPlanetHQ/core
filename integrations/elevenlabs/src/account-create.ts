import { getElevenLabsClient } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  const client = getElevenLabsClient(api_key);

  const userResponse = await client.get('/v1/user');
  const user = userResponse.data;

  const subscriptionResponse = await client.get('/v1/user/subscription');
  const subscription = subscriptionResponse.data;

  return [
    {
      type: 'account',
      data: {
        settings: {
          first_name: user.first_name ?? '',
          last_name: user.last_name ?? '',
          tier: subscription.tier ?? 'free',
        },
        accountId: `elevenlabs-${user.xi_api_key ?? api_key.slice(0, 8)}`,
        config: {
          api_key,
        },
      },
    },
  ];
}
