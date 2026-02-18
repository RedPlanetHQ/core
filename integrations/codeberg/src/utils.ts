import axios from 'axios';

export async function getCodebergData(url: string, accessToken: string) {
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  return response.data;
}
