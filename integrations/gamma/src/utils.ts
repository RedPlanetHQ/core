import axios from 'axios';

const BASE_URL = 'https://public-api.gamma.app/v1.0';

export function getHeaders(apiKey: string) {
  return {
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  };
}

export async function gammaGet(path: string, apiKey: string, params?: Record<string, any>) {
  const response = await axios.get(`${BASE_URL}${path}`, {
    headers: getHeaders(apiKey),
    params,
  });
  return response.data;
}

export async function gammaPost(path: string, apiKey: string, data?: Record<string, any>) {
  const response = await axios.post(`${BASE_URL}${path}`, data, {
    headers: getHeaders(apiKey),
  });
  return response.data;
}
