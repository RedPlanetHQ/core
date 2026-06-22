import { createDatadogClient, getBaseUrl } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key, app_key, region = 'US1' } = data;

  if (!api_key || !app_key) {
    throw new Error('DD-API-KEY and DD-APPLICATION-KEY are required');
  }

  const client = createDatadogClient(api_key, app_key, region);

  // Validate credentials via /api/v1/validate
  const validateRes = await client.get('/api/v1/validate');
  if (!validateRes.data?.valid) {
    throw new Error('Invalid Datadog API key — /api/v1/validate returned invalid');
  }

  // Fetch org info for display name and account ID
  let orgName = 'Datadog';
  let orgPublicId = 'unknown';
  try {
    const orgRes = await client.get('/api/v1/org');
    const org = orgRes.data?.org ?? orgRes.data?.orgs?.[0];
    orgName = org?.name ?? orgName;
    orgPublicId = org?.public_id ?? orgPublicId;
  } catch {
    // non-fatal: org info is cosmetic
  }

  const baseUrl = getBaseUrl(region);

  return [
    {
      type: 'account',
      data: {
        settings: {
          orgName,
          orgPublicId,
          region,
          baseUrl,
        },
        accountId: orgPublicId,
        config: {
          api_key,
          app_key,
          region,
        },
      },
    },
  ];
}
