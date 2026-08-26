import { createBrexClient } from './utils';

/**
 * Validates the Brex customer token by fetching card accounts, then stores
 * the token + resolved primary account metadata on the IntegrationAccount.
 *
 * Called when a user submits the token via the SETUP event (api_key auth).
 */
export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  if (!api_key) {
    throw new Error('Missing api_key');
  }

  const client = createBrexClient(api_key);

  // Fetch card accounts to validate the token and pick an accountId.
  // GET /v2/accounts/card is read-only, required scope: accounts.readonly.
  const response = await client.get('/v2/accounts/card');

  if (response.status !== 200) {
    throw new Error(`Invalid Brex token (status ${response.status})`);
  }

  const items = response.data?.items ?? [];
  const primary = items.find((a: { primary?: boolean }) => a.primary) ?? items[0];

  const accountId = primary?.id ?? 'brex';
  const accountName = primary?.name ?? 'Brex';

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId,
        config: {
          api_key,
          primaryCardAccountId: primary?.id ?? null,
          primaryCardAccountName: accountName,
          connectedAt: new Date().toISOString(),
          tokenLastValidatedAt: new Date().toISOString(),
        },
      },
    },
  ];
}
