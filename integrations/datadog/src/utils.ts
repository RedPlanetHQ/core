import axios, { AxiosInstance } from 'axios';

export type DatadogRegion = 'US1' | 'US3' | 'US5' | 'EU' | 'AP1';

const REGION_BASE_URLS: Record<DatadogRegion, string> = {
  US1: 'https://api.datadoghq.com',
  US3: 'https://us3.datadoghq.com',
  US5: 'https://us5.datadoghq.com',
  EU: 'https://api.datadoghq.eu',
  AP1: 'https://ap1.datadoghq.com',
};

export function getBaseUrl(region: string): string {
  const r = (region || 'US1').toUpperCase() as DatadogRegion;
  return REGION_BASE_URLS[r] ?? REGION_BASE_URLS['US1'];
}

export function createDatadogClient(apiKey: string, appKey: string, region: string): AxiosInstance {
  return axios.create({
    baseURL: getBaseUrl(region),
    headers: {
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      'Content-Type': 'application/json',
    },
  });
}

export interface DatadogConfig {
  api_key: string;
  app_key: string;
  region: string;
}

export function extractConfig(config: Record<string, unknown>): DatadogConfig {
  return {
    api_key: config['api_key'] as string,
    app_key: config['app_key'] as string,
    region: (config['region'] as string) || 'US1',
  };
}

export interface DatadogMonitor {
  id: number;
  name: string;
  type: string;
  status: string;
  overall_state: string;
  message: string;
  modified: string;
  created: string;
  tags: string[];
  query: string;
}

export interface DatadogEvent {
  id: number;
  title: string;
  text: string;
  date_happened: number;
  priority: string;
  source: string;
  tags: string[];
  url: string;
  alert_type?: string;
  host?: string;
}

/**
 * Fetch monitors with pagination
 */
export async function fetchMonitors(
  client: AxiosInstance,
  page = 0,
  pageSize = 100,
): Promise<DatadogMonitor[]> {
  const response = await client.get('/api/v1/monitor', {
    params: { page, page_size: pageSize },
  });
  return response.data as DatadogMonitor[];
}

/**
 * Fetch events between start and end (Unix timestamps)
 * Returns events and whether there may be more pages.
 */
export async function fetchEvents(
  client: AxiosInstance,
  start: number,
  end: number,
  page = 0,
): Promise<{ events: DatadogEvent[]; hasMore: boolean }> {
  const response = await client.get('/api/v1/events', {
    params: { start, end, count: 100, page },
  });
  const events: DatadogEvent[] = response.data?.events ?? [];
  // Datadog returns up to 100 events per page; if we got a full page, there may be more
  return { events, hasMore: events.length === 100 };
}

/**
 * Fetch all events since lastTimestamp using pagination.
 */
export async function fetchAllEventsSince(
  client: AxiosInstance,
  lastTimestamp: number,
): Promise<DatadogEvent[]> {
  const now = Math.floor(Date.now() / 1000);
  const allEvents: DatadogEvent[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const result = await fetchEvents(client, lastTimestamp, now, page);
      allEvents.push(...result.events);
      hasMore = result.hasMore;
      page += 1;
    } catch {
      hasMore = false;
    }
  }

  return allEvents;
}
