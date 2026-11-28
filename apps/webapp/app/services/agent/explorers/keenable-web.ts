/**
 * Keenable backend for the Web Explorer, used only when EXA_API_KEY is not set
 * and KEENABLE_API_KEY is. Plain fetch, no SDK. The output strings match the
 * Exa path so the explorer prompt doesn't change.
 */

const KEENABLE_BASE_URL = "https://api.keenable.ai/v1";
const KEENABLE_APP_TITLE = "core";

type KeenableSearchHit = {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
};

type KeenableFetchPage = {
  url?: string;
  title?: string;
  content?: string;
  error?: { message?: string } | string;
};

async function postKeenable(
  apiKey: string,
  path: "search" | "fetch",
  body: Record<string, unknown>
): Promise<any> {
  const response = await fetch(`${KEENABLE_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Keenable-Title": KEENABLE_APP_TITLE,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Best-effort decode for the error message only.
    const data = await response.json().catch(() => null);
    const message = (data && (data.message || data.error)) || `HTTP ${response.status}`;
    throw new Error(`Keenable ${path} failed (${response.status}): ${message}`);
  }
  // On a 200, a body read or decode failure propagates to the tool's error handler.
  return response.json();
}

export async function keenableWebSearch(
  apiKey: string,
  query: string,
  numResults: number
): Promise<string> {
  const data = await postKeenable(apiKey, "search", {
    query,
    max_results: numResults,
    snippet_max_length: 500,
  });
  const hits: KeenableSearchHit[] = Array.isArray(data?.results)
    ? data.results.filter((r: KeenableSearchHit) => r && r.url)
    : [];
  if (hits.length === 0) {
    return "No results found";
  }
  return hits
    .map(
      (r, i) => `[${i + 1}] ${r.title || "Untitled"}
URL: ${r.url}
${r.snippet || r.description || ""}`
    )
    .join("\n\n");
}

export async function keenableGetContents(
  apiKey: string,
  urls: string[],
  maxCharacters = 3000
): Promise<string> {
  // Keenable rejects duplicate URLs with a 400, so send each URL once (order kept).
  const data = await postKeenable(apiKey, "fetch", { urls: [...new Set(urls)] });
  const pages: KeenableFetchPage[] = Array.isArray(data?.results) ? data.results : [];
  // A page Keenable can't read comes back with a per-URL `error` inside a 200.
  const readable = pages.filter((p) => p && !p.error && p.content);
  if (readable.length === 0) {
    return "Could not fetch content from URLs";
  }
  return readable
    .map(
      (p) => `## ${p.title || "Untitled"}
URL: ${p.url}

${(p.content || "").substring(0, maxCharacters) || "No content available"}`
    )
    .join("\n\n---\n\n");
}
