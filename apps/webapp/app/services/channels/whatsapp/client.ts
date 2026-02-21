import Twilio from "twilio";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";

// Lazy-init Twilio client singleton
let twilioClient: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
  if (!twilioClient) {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new Error("Twilio credentials not configured");
    }
    twilioClient = Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
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
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
): Promise<void> {
  const client = getClient();
  const from = `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`;
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
 * Verify Twilio webhook signature
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  if (!env.TWILIO_AUTH_TOKEN) {
    logger.warn("Twilio auth token not configured, skipping signature verification");
    return false;
  }
  return Twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}
