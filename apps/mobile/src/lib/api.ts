import { API_URL } from "./config";
import { getPat } from "./storage";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { auth = true, headers, body, ...rest } = opts;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...((headers as Record<string, string>) ?? {}),
  };

  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
  }

  if (auth) {
    const pat = await getPat();
    if (pat) finalHeaders.Authorization = `Bearer ${pat}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (!res.ok) throw new ApiError(res.status, parsed ?? text);

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
