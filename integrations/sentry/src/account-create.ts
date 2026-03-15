import { getSentryClient } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { auth_token, host } = data;

  const baseURL = (host || 'https://sentry.io').replace(/\/$/, '');
  const client = getSentryClient(auth_token, baseURL);

  // Validate the token and fetch current user info
  const userResponse = await client.get('/api/0/');
  const version = userResponse.data?.version ?? 'unknown';

  // Fetch the first available organization
  const orgsResponse = await client.get('/api/0/organizations/');
  const orgs: Array<{ slug: string; name: string; id: string }> = orgsResponse.data || [];
  const firstOrg = orgs[0];

  const organizationSlug = firstOrg?.slug ?? '';
  const organizationName = firstOrg?.name ?? '';

  return [
    {
      type: 'account',
      data: {
        settings: {
          organization_name: organizationName,
          sentry_version: version,
        },
        accountId: `sentry-${organizationSlug}`,
        config: {
          auth_token,
          host: baseURL,
          organization_slug: organizationSlug,
        },
      },
    },
  ];
}
