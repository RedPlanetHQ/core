import { sendPlainTextEmail } from "~/services/email.server";
import { env } from "~/env.server";
import type { ReplyMetadata } from "../types";

/**
 * Send an email reply. Delegates to the existing Resend/SMTP helper.
 */
export async function sendReply(
  to: string,
  text: string,
  metadata?: ReplyMetadata,
): Promise<void> {
  const subject = metadata?.subject
    ? `Re: ${metadata.subject}`
    : "CORE Brain";

  await sendPlainTextEmail({
    to,
    replyTo: env.FROM_EMAIL,
    subject,
    text,
  });
}
