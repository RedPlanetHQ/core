import axios, { AxiosInstance } from 'axios';

export interface MixpanelConfig {
  service_account_username: string;
  service_account_secret: string;
  project_id: string;
  region: 'US' | 'EU';
}

const US_API_BASE = 'https://mixpanel.com';
const EU_API_BASE = 'https://eu.mixpanel.com';
const US_DATA_BASE = 'https://data.mixpanel.com';
const EU_DATA_BASE = 'https://data-eu.mixpanel.com';

export function getApiBase(region: 'US' | 'EU'): string {
  return region === 'EU' ? EU_API_BASE : US_API_BASE;
}

export function getDataBase(region: 'US' | 'EU'): string {
  return region === 'EU' ? EU_DATA_BASE : US_DATA_BASE;
}

export function getMixpanelClient(config: MixpanelConfig): AxiosInstance {
  const token = Buffer.from(
    `${config.service_account_username}:${config.service_account_secret}`
  ).toString('base64');

  return axios.create({
    baseURL: getApiBase(config.region),
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

export function getDataClient(config: MixpanelConfig): AxiosInstance {
  const token = Buffer.from(
    `${config.service_account_username}:${config.service_account_secret}`
  ).toString('base64');

  return axios.create({
    baseURL: getDataBase(config.region),
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'text/plain',
    },
  });
}

/**
 * Parse newline-delimited JSON (NDJSON) returned by Mixpanel's export endpoint.
 */
export function parseNDJSON(raw: string): Record<string, unknown>[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, unknown> => item !== null);
}

/**
 * Format a date as YYYY-MM-DD for Mixpanel date range parameters.
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
