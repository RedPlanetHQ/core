import { callbackHandler } from "~/services/oauth/oauth.server";
import type { CallbackParams } from "~/services/oauth/oauth-utils.server";
import { type LoaderFunctionArgs } from "@remix-run/node";

// This route handles the OAuth callback, similar to the NestJS controller
export async function loader({ request }: LoaderFunctionArgs) {
  // Handle CORS preflight
  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Only allow GET requests
  if (request.method.toUpperCase() !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  try {
    const url = new URL(request.url);
    const params: CallbackParams = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    return await callbackHandler(params);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
