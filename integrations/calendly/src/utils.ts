import axios from 'axios';

export const CALENDLY_API_BASE = 'https://api.calendly.com';

export function createCalendlyClient(accessToken: string) {
  return axios.create({
    baseURL: CALENDLY_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

export async function getCurrentUser(accessToken: string) {
  const client = createCalendlyClient(accessToken);
  const res = await client.get('/users/me');
  return res.data.resource;
}
