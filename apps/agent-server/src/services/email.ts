import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(
  to: string,
  verificationLink: string,
  inReplyTo?: string,
  message?: string
): Promise<void> {
  try {
    const emailOptions: any = {
      from: env.FROM_EMAIL,
      to,
      subject: 'SOL',
      text: message || `SOL.\n\nVerify: ${verificationLink}\n\nThen we talk.`,
    };

    // Add threading headers if replying to an existing email
    if (inReplyTo) {
      emailOptions.headers = {
        'In-Reply-To': inReplyTo,
        'References': inReplyTo,
      };
    }

    await resend.emails.send(emailOptions);
    logger.info(`Verification email sent to ${to}`);
  } catch (error) {
    logger.error('Failed to send verification email', error);
    throw error;
  }
}

export async function sendAgentReply(
  to: string,
  message: string,
  options?: {
    subject?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<void> {
  try {
    const emailOptions: any = {
      from: env.FROM_EMAIL,
      to,
      subject: options?.subject || 'Re: CORE Agent',
      text: message,
    };

    // Add threading headers to keep replies in the same thread
    if (options?.inReplyTo || options?.references) {
      emailOptions.headers = {
        'In-Reply-To': options.inReplyTo,
        'References': options.references || options.inReplyTo,
      };
    }

    await resend.emails.send(emailOptions);
    logger.info(`Agent reply sent to ${to}`);
  } catch (error) {
    logger.error('Failed to send agent reply', error);
    throw error;
  }
}
