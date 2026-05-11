import axios, { AxiosError, AxiosInstance } from "axios";

const POSTMAN_API_BASE = "https://api.getpostman.com";

export function createPostmanClient(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: POSTMAN_API_BASE,
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
    },
    timeout: 30_000,
  });
}

const clientCache = new Map<string, AxiosInstance>();

function getPostmanClient(apiKey: string): AxiosInstance {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = createPostmanClient(apiKey);
    clientCache.set(apiKey, client);
  }
  return client;
}

export async function postmanGet<T = any>(
  path: string,
  apiKey: string,
  params?: Record<string, any>
): Promise<T> {
  const client = getPostmanClient(apiKey);
  try {
    const res = await client.get<T>(path, { params });
    return res.data;
  } catch (err) {
    throw normalizeError(err, "GET", path);
  }
}

function normalizeError(err: unknown, method: string, path: string): Error {
  const ax = err as AxiosError<any>;
  if (ax.isAxiosError) {
    const status = ax.response?.status;
    const apiMessage =
      ax.response?.data?.error?.message ?? ax.response?.data?.message ?? ax.message;
    if (status === 429) {
      return new Error(`Postman ${method} ${path} hit rate limit (429). Back off and retry.`);
    }
    return new Error(`Postman ${method} ${path} failed (${status}): ${apiMessage}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function formatDate(value?: string | number | Date): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}
