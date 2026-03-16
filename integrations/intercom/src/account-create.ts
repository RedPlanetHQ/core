import { getIntercomClient } from './utils';

export async function integrationCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const { oauthResponse } = data;
  const integrationConfiguration = {
    refresh_token: oauthResponse.refresh_token,
    access_token: oauthResponse.access_token,
  };

  const client = getIntercomClient(integrationConfiguration.access_token);

  // Fetch the authenticated admin/user info
  const meResponse = await client.get('/me');
  const me = meResponse.data;

  const accountId = me.id?.toString() ?? me.email ?? 'intercom-account';
  const email = me.email ?? '';
  const name = me.name ?? '';

  return [
    {
      type: 'account',
      data: {
        settings: {
          email,
          name,
          app_id: me.app?.id_code ?? '',
          app_name: me.app?.name ?? '',
        },
        accountId,
        config: {
          ...integrationConfiguration,
        },
      },
    },
  ];
}
