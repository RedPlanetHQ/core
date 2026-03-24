import Twilio from "twilio";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
}

function getEnvCredentials(): TwilioCredentials | null {
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_WHATSAPP_NUMBER
  ) {
    return null;
  }
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    whatsappNumber: env.TWILIO_WHATSAPP_NUMBER,
  };
}

const MESSAGE_CHAR_LIMIT = 1550;
const MESSAGE_SEPARATOR = "---MSG---";

/**
 * Split a long message into chunks that fit within WhatsApp's character limit.
 * First splits by explicit separator, then by character limit.
 */
export function splitMessage(
  text: string,
  limit: number = MESSAGE_CHAR_LIMIT,
): string[] {
  // Split by explicit separator first
  const sections = text.split(MESSAGE_SEPARATOR).map((s) => s.trim()).filter(Boolean);

  const chunks: string[] = [];
  for (const section of sections) {
    if (section.length <= limit) {
      chunks.push(section);
    } else {
      // Split long sections by character limit at newline boundaries
      let remaining = section;
      while (remaining.length > 0) {
        if (remaining.length <= limit) {
          chunks.push(remaining);
          break;
        }
        // Find last newline within limit
        let splitIndex = remaining.lastIndexOf("\n", limit);
        if (splitIndex <= 0) {
          // No newline found, split at limit
          splitIndex = limit;
        }
        chunks.push(remaining.substring(0, splitIndex).trim());
        remaining = remaining.substring(splitIndex).trim();
      }
    }
  }

  return chunks;
}

/**
 * Send a WhatsApp message via Twilio.
 * Automatically splits long messages.
 * Accepts explicit credentials or falls back to env vars.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  credentials?: TwilioCredentials,
): Promise<void> {
  const creds = credentials ?? getEnvCredentials();
  if (!creds) {
    throw new Error("Twilio credentials not configured");
  }

  const client = Twilio(creds.accountSid, creds.authToken);
  const from = `whatsapp:${creds.whatsappNumber}`;
  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const chunks = splitMessage(body);

  for (const chunk of chunks) {
    try {
      await client.messages.create({
        from,
        to: toFormatted,
        body: chunk,
      });
    } catch (error) {
      logger.error("Failed to send WhatsApp message", {
        to,
        error: String(error),
      });
      throw error;
    }
  }
}

/**
 * Send a typing indicator via the Twilio Messaging API.
 * Accepts explicit credentials or falls back to env vars.
 */
export async function sendWhatsAppTypingIndicator(
  messageSid: string,
  credentials?: TwilioCredentials,
): Promise<void> {
  try {
    const creds = credentials ?? getEnvCredentials();
    if (!creds) return;

    const auth = Buffer.from(
      `${creds.accountSid}:${creds.authToken}`,
    ).toString("base64");

    await fetch("https://messaging.twilio.com/v2/Indicators/Typing.json", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        messageId: messageSid,
        channel: "whatsapp",
      }),
    });
  } catch (error) {
    // Non-critical — don't let typing indicator failures break the flow
    logger.warn("Failed to send WhatsApp typing indicator", {
      error: String(error),
    });
  }
}

/**
 * Verify Twilio webhook signature.
 * Accepts explicit authToken or falls back to env var.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken?: string,
): boolean {
  const token = authToken ?? env.TWILIO_AUTH_TOKEN;
  if (!token) {
    logger.warn("Twilio auth token not configured, skipping signature verification");
    return false;
  }
  return Twilio.validateRequest(token, signature, url, params);
}
