/**
 * Telegram Webhook Route
 *
 * POST /webhooks/telegram?channelId=<id>
 *
 * Receives Telegram Bot API updates, verifies the secret token header,
 * parses the update, and feeds it into the CORE inbound message pipeline.
 */

import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { handleChannelMessage } from "~/services/channels";
import { verifyTelegramUpdate } from "~/services/channels/telegram/client";
import { parseTelegramUpdate } from "~/services/channels/telegram/inbound";
import { logger } from "~/services/logger.service";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId") ?? undefined;

  // Verify Telegram secret token header (configured when calling setWebhook)
  const secretToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!verifyTelegramUpdate(secretToken, configuredSecret)) {
    logger.warn("Invalid Telegram webhook secret token");
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Acknowledge immediately and process async (Telegram expects a fast 200)
  void (async () => {
    try {
      const result = await parseTelegramUpdate(body, channelId);
      if (result.message) {
        await handleChannelMessage("telegram", result.message);
      }
    } catch (err) {
      logger.error("Telegram update processing failed", { error: String(err) });
    }
  })();

  return json({ ok: true }, { status: 200 });
}
