import axios from 'axios';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  // Validate the API key by fetching the domains list
  const response = await axios.get('https://api.resend.com/domains', {
    headers: {
      Authorization: `Bearer ${api_key}`,
    },
  });

  if (response.status !== 200) {
    throw new Error('Invalid Resend API key');
  }

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId: 'resend',
        config: {
          api_key,
        },
      },
    },
  ];
}
