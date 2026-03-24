import crypto from "crypto";

const BASE = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${BASE(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description}`);
  }
}

export async function setTelegramWebhook(
  token: string,
  url: string,
  secretToken?: string,
): Promise<void> {
  const body: Record<string, string> = { url };
  if (secretToken) {
    body.secret_token = secretToken;
  }
  const res = await fetch(`${BASE(token)}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram setWebhook failed: ${data.description}`);
  }
}

export async function deleteTelegramWebhook(token: string): Promise<void> {
  const res = await fetch(`${BASE(token)}/deleteWebhook`, {
    method: "POST",
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram deleteWebhook failed: ${data.description}`);
  }
}

/**
 * Verify a Telegram webhook request using the X-Telegram-Bot-Api-Secret-Token header.
 * Returns true if secretToken is not configured (skip check).
 */
export function verifyTelegramUpdate(
  secretTokenHeader: string | null,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) return true;
  if (!secretTokenHeader) return false;
  return crypto.timingSafeEqual(
    Buffer.from(secretTokenHeader),
    Buffer.from(configuredSecret),
  );
}
