import axios, { AxiosInstance } from 'axios';

export interface SentryConfig {
  auth_token: string;
  organization_slug: string;
  host: string;
}

export function getSentryClient(authToken: string, host: string): AxiosInstance {
  const baseURL = (host || 'https://sentry.io').replace(/\/$/, '');
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });
}
