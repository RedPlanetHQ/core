import { gammaGet } from './utils';

export async function integrationCreate({ api_key }: { api_key: string }) {
  // Validate the API key by fetching the current user
  let user: any;
  try {
    user = await gammaGet('/me', api_key);
  } catch (error: any) {
    throw new Error(
      `Failed to validate Gamma API key: ${error.response?.data?.message || error.message}`
    );
  }

  if (!user || (!user.id && !user.email)) {
    throw new Error('Could not extract user info from Gamma API response');
  }

  const accountId = user.id || user.email;

  return [
    {
      type: 'account',
      data: {
        accountId,
        config: { api_key },
        settings: {
          email: user.email,
          name: user.name || user.displayName,
        },
      },
    },
  ];
}
