import axios from 'axios';

export function getMetabaseClient(baseUrl: string, apiKey: string) {
  return axios.create({
    baseURL: `${baseUrl.replace(/\/$/, '')}/api`,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });
}

export async function validateMetabaseConnection(baseUrl: string, apiKey: string) {
  const client = getMetabaseClient(baseUrl, apiKey);
  const response = await client.get('/user/current');
  return response.data;
}
