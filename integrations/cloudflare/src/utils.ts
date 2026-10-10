import axios, { AxiosInstance } from 'axios';

const CLOUDFLARE_BASE_URL = 'https://api.cloudflare.com/client/v4';

export interface CloudflareConfig {
  api_token: string;
}

export function getCloudflareClient(apiToken: string): AxiosInstance {
  return axios.create({
    baseURL: CLOUDFLARE_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });
}
