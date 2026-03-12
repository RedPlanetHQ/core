import axios, { AxiosInstance } from 'axios';

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';

let whoopClient: AxiosInstance;

export function initializeClient(accessToken: string) {
  whoopClient = axios.create({
    baseURL: WHOOP_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

export async function getWhoopData(
  path: string,
  params?: Record<string, string | number>
): Promise<any> {
  const response = await whoopClient.get(path, { params });
  return response.data;
}

export async function getPaginatedWhoopData(
  path: string,
  params?: Record<string, string | number>
): Promise<any[]> {
  const results: any[] = [];
  let nextToken: string | undefined;

  do {
    const queryParams: Record<string, string | number> = {
      limit: 25,
      ...params,
      ...(nextToken ? { nextToken } : {}),
    };

    const data = await getWhoopData(path, queryParams);

    if (data.records && Array.isArray(data.records)) {
      results.push(...data.records);
    }

    nextToken = data.next_token;
  } while (nextToken);

  return results;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function metersToMiles(meters: number): string {
  return (meters / 1609.34).toFixed(2);
}

export function secondsToHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}
