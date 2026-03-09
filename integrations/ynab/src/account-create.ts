import axios from 'axios';

export async function integrationCreate(data: Record<string, string>) {
  const { api_key } = data;

  // Validate the API key by fetching the user's budgets
  const response = await axios.get('https://api.ynab.com/v1/budgets', {
    headers: {
      Authorization: `Bearer ${api_key}`,
    },
  });

  if (response.status !== 200) {
    throw new Error('Invalid YNAB API key');
  }

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId: 'ynab',
        config: {
          api_key,
        },
      },
    },
  ];
}
