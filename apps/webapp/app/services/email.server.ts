import {
  type DeliverEmail,
  type SendPlainTextOptions,
  EmailClient,
  type MailTransportOptions,
} from "emails";

import { env } from "~/env.server";

import { logger } from "./logger.service";
import { singleton } from "~/utils/singleton";

const client = singleton(
  "email-client",
  () =>
    new EmailClient({
      transport: buildTransportOptions(),
      imagesBaseUrl: env.APP_ORIGIN,
      from: env.FROM_EMAIL ?? "Manik <manik@poozle.dev>",
      replyTo: env.REPLY_TO_EMAIL ?? "manik@poozle.dev",
    }),
);

function buildTransportOptions(): MailTransportOptions {
  const transportType = env.EMAIL_TRANSPORT;
  logger.debug(
    `Constructing email transport '${transportType}' for usage general`,
  );

  switch (transportType) {
    case "aws-ses":
      return { type: "aws-ses" };
    case "resend":
      return {
        type: "resend",
        config: {
          apiKey: env.RESEND_API_KEY,
        },
      };
    case "smtp":
      return {
        type: "smtp",
        config: {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
          },
        },
      };
    default:
      return { type: undefined };
  }
}

export async function sendMagicLinkEmail(options: any): Promise<void> {
  logger.debug("Sending magic link email", {
    email: options.email,
  });

  try {
    return await client.send({
      email: "magic_link",
      to: options.email,
      magicLink: options.magicLink,
    });
  } catch (error) {
    logger.error("Error sending magic link email", {
      error: JSON.stringify(error),
    });

    throw error;
  }
}

export async function sendPlainTextEmail(options: SendPlainTextOptions) {
  return client.sendPlainText(options);
}

export async function scheduleEmail(
  data: DeliverEmail,
  delay?: { seconds: number },
) { }

export async function sendPaymentFailedEmail(options: {
  email: string;
  userName?: string;
  planName?: string;
  amount?: number;
  currency?: string;
  nextRetryDate?: string;
}) {
  logger.debug("Sending payment failed email", {
    email: options.email,
  });

  try {
    return await client.send({
      email: "payment_failed",
      to: options.email,
      userName: options.userName,
      planName: options.planName,
      amount: options.amount,
      currency: options.currency,
      nextRetryDate: options.nextRetryDate,
      updatePaymentUrl: `${env.APP_ORIGIN}/settings/billing`,
    });
  } catch (error) {
    logger.error("Error sending payment failed email", {
      error: JSON.stringify(error),
    });

    throw error;
  }
}

export async function sendEmail(data: DeliverEmail) {
  try {
    const response = client.send(data);

    return response;
  } catch (e) {
    logger.error(`Error: ${e}`);
  }
}
