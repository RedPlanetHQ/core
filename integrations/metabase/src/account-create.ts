import { validateMetabaseConnection } from './utils';

export async function integrationCreate(data: Record<string, string>) {
  const { metabase_url, api_key } = data;

  const cleanUrl = metabase_url.replace(/\/$/, '');

  const user = await validateMetabaseConnection(cleanUrl, api_key);

  return [
    {
      type: 'account',
      data: {
        settings: {
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          metabase_url: cleanUrl,
        },
        accountId: `metabase-${user.id}`,
        config: {
          metabase_url: cleanUrl,
          api_key,
        },
      },
    },
  ];
}
