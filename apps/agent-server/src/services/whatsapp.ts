import twilio from 'twilio';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  try {
    // Ensure phone number has whatsapp: prefix
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    await twilioClient.messages.create({
      from: env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo,
      body: message,
    });

    logger.info(`WhatsApp message sent to ${to}`);
  } catch (error) {
    logger.error('Failed to send WhatsApp message', error);
    throw error;
  }
}

export function verifyWebhookSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, any>
): boolean {
  if (!signature) {
    logger.warn('No Twilio signature provided');
    return false;
  }

  try {
    return twilio.validateRequest(
      env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      params
    );
  } catch (error) {
    logger.error('Failed to verify Twilio signature', error);
    return false;
  }
}
