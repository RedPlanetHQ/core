import { callFirefliesAPI } from './utils';

export async function integrationCreate(data: Record<string, any>) {
  const { api_key } = data;

  const query = `
    query {
      user {
        uid
        name
        email
      }
    }
  `;

  const result = await callFirefliesAPI({ api_key }, query);
  const user = result.user;

  return [
    {
      type: 'account',
      data: {
        accountId: user.email,
        config: { api_key },
        settings: {},
      },
    },
  ];
}
