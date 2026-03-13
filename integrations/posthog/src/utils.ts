import axios, { AxiosInstance } from 'axios';

export function getPostHogClient(apiKey: string, host: string): AxiosInstance {
  return axios.create({
    baseURL: host,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Paginate through all pages of a PostHog list endpoint.
 * PostHog uses cursor-based pagination with a `next` URL in the response.
 */
export async function paginateAll<T>(
  client: AxiosInstance,
  path: string,
  params?: Record<string, string | number>,
  maxPages = 10
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = path;
  let page = 0;

  while (url && page < maxPages) {
    const response: { data: Record<string, any> } = await client.get(url, page === 0 ? { params } : {});
    const data: Record<string, any> = response.data;

    if (Array.isArray(data['results'])) {
      results.push(...(data['results'] as T[]));
    }

    // PostHog returns an absolute `next` URL — strip the base to get the path+query
    if (data['next']) {
      const nextUrl: URL = new URL(data['next'] as string);
      url = nextUrl.pathname + nextUrl.search;
    } else {
      url = null;
    }

    page++;
  }

  return results;
}

export interface PostHogConfig {
  api_key: string;
  host: string;
  project_id: string;
}
