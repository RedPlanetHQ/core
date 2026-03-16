import axios, { AxiosInstance } from 'axios';

export const INTERCOM_API_BASE = 'https://api.intercom.io';

export interface IntercomConfig {
  access_token: string;
}

export function getIntercomClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: INTERCOM_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

/**
 * Paginate through all pages of an Intercom list endpoint.
 * Intercom uses cursor-based pagination with a `pages.next.starting_after` cursor.
 */
export async function paginateAll<T>(
  client: AxiosInstance,
  path: string,
  dataKey: string,
  params?: Record<string, string | number>,
  maxPages = 10,
): Promise<T[]> {
  const results: T[] = [];
  let page = 0;
  let startingAfter: string | null = null;

  while (page < maxPages) {
    const requestParams: Record<string, string | number> = { ...(params || {}), per_page: 50 };
    if (startingAfter) {
      requestParams['starting_after'] = startingAfter;
    }

    const response: { data: Record<string, any> } = await client.get(path, {
      params: requestParams,
    });
    const data: Record<string, any> = response.data;

    if (Array.isArray(data[dataKey])) {
      results.push(...(data[dataKey] as T[]));
    }

    const nextCursor = data?.pages?.next?.starting_after;
    if (nextCursor) {
      startingAfter = nextCursor;
    } else {
      break;
    }

    page++;
  }

  return results;
}
