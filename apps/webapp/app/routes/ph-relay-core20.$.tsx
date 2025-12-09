import type { ActionFunction, LoaderFunction } from "@remix-run/node";

const API_HOST = "us.i.posthog.com";
const ASSET_HOST = "us-assets.i.posthog.com";

const posthogProxy = async (request: Request) => {
  const url = new URL(request.url);
  const hostname = url.pathname.startsWith("/ph-relay-core20/static/")
    ? ASSET_HOST
    : API_HOST;

  const newUrl = new URL(url);
  newUrl.protocol = "https";
  newUrl.hostname = hostname;
  newUrl.port = "443";
  newUrl.pathname = newUrl.pathname.replace(/^\/ph-relay-core20/, "");

  const headers = new Headers(request.headers);
  headers.set("host", hostname);

  try {
    const response = await fetch(newUrl, {
      duplex: "half",
      method: request.method,
      headers,
      body: request.body,
    });

    // Remove encoding headers to prevent double-decompression errors
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    // Handle network errors gracefully (ECONNREFUSED, DNS failures, etc.)
    console.error("PostHog proxy error:", error);

    // Return empty success responses for analytics endpoints
    // This prevents breaking the app when PostHog is unreachable
    if (request.method === "POST") {
      return new Response(JSON.stringify({ status: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // For GET requests (config, etc.), return minimal valid response
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const loader: LoaderFunction = async ({ request }) =>
  posthogProxy(request);

export const action: ActionFunction = async ({ request }) =>
  posthogProxy(request);
