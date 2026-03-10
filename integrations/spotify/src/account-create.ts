import axios from 'axios';

export async function integrationCreate(data: Record<string, string>) {
  const { client_id, client_secret } = data;

  // Validate credentials via Spotify Client Credentials token endpoint
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  if (response.status !== 200 || !response.data.access_token) {
    throw new Error('Invalid Spotify credentials');
  }

  return [
    {
      type: 'account',
      data: {
        settings: {},
        accountId: 'spotify',
        config: {
          client_id,
          client_secret,
        },
      },
    },
  ];
}
