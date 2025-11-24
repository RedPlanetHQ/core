import axios from 'axios';

export async function integrationCreate({ apiKey }: { apiKey: string }) {
  // Fetch the Cal.com user info using the API
  const response = await axios.get('https://api.cal.com/v2/me', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'cal-api-version': '2024-08-13',
    },
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch Cal.com user: ${response.status} ${response.statusText}`);
  }

  const userData = response.data.data;
  const userId = userData?.id;

  if (!userId) {
    throw new Error('Could not extract userId from Cal.com API response');
  }

  return [
    {
      type: 'account',
      data: {
        settings: {
          user: {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            username: userData.username,
          },
        },
        accountId: userData.email || userId,
        config: { apiKey },
      },
    },
  ];
}
