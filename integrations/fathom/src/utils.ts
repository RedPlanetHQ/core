import axios from 'axios';

const FATHOM_API_BASE = 'https://api.fathom.video/external/v1';

export function createFathomClient(apiKey: string) {
  return axios.create({
    baseURL: FATHOM_API_BASE,
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });
}

export interface FathomPaginatedResponse<T> {
  data: T[];
  cursor?: string;
  has_more?: boolean;
}

export async function fetchAllPages<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  maxPages = 5,
): Promise<T[]> {
  const client = createFathomClient(apiKey);
  const results: T[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const queryParams: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) queryParams[k] = v;
    }
    if (cursor) queryParams.cursor = cursor;

    const response = await client.get(path, { params: queryParams });
    const body = response.data;

    if (Array.isArray(body)) {
      results.push(...body);
      break;
    }

    if (body.data) {
      results.push(...body.data);
    }

    cursor = body.cursor;
    const hasMore: boolean = body.has_more ?? !!cursor;
    pages++;

    if (!hasMore) break;
  } while (pages < maxPages);

  return results;
}

export async function fathomGet(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  const client = createFathomClient(apiKey);
  const queryParams: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) queryParams[k] = v;
    }
  }
  const response = await client.get(path, { params: queryParams });
  return response.data;
}

export async function fathomPost(
  apiKey: string,
  path: string,
  data?: Record<string, unknown>,
) {
  const client = createFathomClient(apiKey);
  const response = await client.post(path, data);
  return response.data;
}

export async function fathomDelete(apiKey: string, path: string) {
  const client = createFathomClient(apiKey);
  const response = await client.delete(path);
  return response.data;
}
