import axios from 'axios';

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

export function createFathomClient(apiKey: string) {
  return axios.create({
    baseURL: FATHOM_API_BASE,
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });
}

export type FathomRecorder = string | { name?: string; email?: string };

export interface FathomMeeting {
  recording_id?: number;
  id?: string;
  title?: string;
  created_at?: string;
  duration?: number;
  recorded_by?: FathomRecorder;
  share_url?: string;
  url?: string;
}

export function fathomRecorderName(recorder?: FathomRecorder): string | undefined {
  return typeof recorder === 'string' ? recorder : (recorder?.name ?? recorder?.email);
}

export interface FathomPaginatedResponse<T> {
  items?: T[];
  next_cursor?: string | null;
  data?: T[];
  cursor?: string;
  has_more?: boolean;
}

export async function fetchAllPages<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  maxPages = 5,
  maxItems = Infinity,
): Promise<T[]> {
  const client = createFathomClient(apiKey);
  const results: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  const seenCursors = new Set<string>();

  do {
    const queryParams: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) queryParams[k] = v;
    }
    if (cursor) queryParams.cursor = cursor;

    const response = await client.get<FathomPaginatedResponse<T> | T[]>(path, {
      params: queryParams,
    });
    const body = response.data;

    if (Array.isArray(body)) {
      results.push(...body);
      break;
    }

    const items = body?.items ?? body?.data;
    if (!Array.isArray(items)) throw new Error('Fathom returned an invalid page');
    results.push(...items);
    const nextCursor = body.next_cursor === undefined ? body.cursor : body.next_cursor;
    pages++;

    if (!nextCursor || body.has_more === false || results.length >= maxItems) break;
    if (seenCursors.has(nextCursor)) throw new Error('Fathom returned a repeated page cursor');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (pages < maxPages);

  return results.slice(0, maxItems);
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

export async function fathomPost(apiKey: string, path: string, data?: Record<string, unknown>) {
  const client = createFathomClient(apiKey);
  const response = await client.post(path, data);
  return response.data;
}

export async function fathomDelete(apiKey: string, path: string) {
  const client = createFathomClient(apiKey);
  const response = await client.delete(path);
  return response.data;
}
