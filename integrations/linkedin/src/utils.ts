import axios from 'axios';

export async function getLinkedInData(url: string, accessToken: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  // Only use Restli header for legacy v2 endpoints
  if (url.includes('/v2/')) {
    headers['X-Restli-Protocol-Version'] = '2.0.0';
  }

  return (
    await axios.get(url, {
      headers,
    })
  ).data;
}

export async function postLinkedInData(url: string, data: any, accessToken: string) {
  return (
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    })
  ).data;
}