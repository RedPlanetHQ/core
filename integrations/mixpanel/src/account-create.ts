import { getMixpanelClient, MixpanelConfig } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { service_account_username, service_account_secret, project_id, region } = data;

  const config: MixpanelConfig = {
    service_account_username,
    service_account_secret,
    project_id,
    region: (region as 'US' | 'EU') || 'US',
  };

  const client = getMixpanelClient(config);

  // Validate credentials by fetching project details
  const response = await client.get('/api/app/me/', {
    params: { project_id },
  });

  const user = response.data;

  return [
    {
      type: 'account',
      data: {
        settings: {
          username: user?.results?.user?.username ?? service_account_username,
          project_id,
          region: config.region,
        },
        accountId: `mixpanel-${project_id}`,
        config: {
          service_account_username,
          service_account_secret,
          project_id,
          region: config.region,
        },
      },
    },
  ];
}
