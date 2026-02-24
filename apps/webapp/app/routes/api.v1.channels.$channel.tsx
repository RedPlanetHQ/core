/**
 * Unified Channel Webhook Route
 *
 * Dispatches inbound messages to the correct channel handler (WhatsApp, Email, …)
 * via `handleChannelMessage(slug, request)`.
 */

import { type ActionFunctionArgs, json } from "@remix-run/node";
import { getChannel, handleChannelMessage } from "~/services/channels";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const slug = params.channel;
  if (!slug) {
    return json({ error: "Missing channel" }, { status: 400 });
  }

  try {
    getChannel(slug);
  } catch {
    return json({ error: "Unknown channel" }, { status: 404 });
  }

  return handleChannelMessage(slug, request);
}
