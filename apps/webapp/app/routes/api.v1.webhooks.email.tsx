/**
 * Email Inbound Webhook (Resend)
 *
 * Public endpoint — receives inbound emails from Resend webhook.
 * Resend sends { type: "email.received", data: { email_id, from, subject, ... } }
 * Body is NOT in the webhook — must be fetched via Resend Receiving API.
 */

import { type ActionFunctionArgs, json } from "@remix-run/node";
import { getUserByEmail } from "~/models/user.server";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { sendPlainTextEmail } from "~/services/email.server";
import { processInboundMessage } from "~/services/agent/message-processor";
import { logger } from "~/services/logger.service";
import { Resend } from "resend";



interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    message_id?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
    }>;
  };
}

/**
 * Extract plain email address from "Name <email>" format.
 */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only handle email.received events
  if (payload.type !== "email.received") {
    return json({ received: true }, { status: 200 });
  }

  const { email_id, from, to, subject, message_id } = payload.data ?? {};
  if (!email_id || !from) {
    return json({ error: "Missing email_id or from" }, { status: 400 });
  }

  if (!to || !to.includes('brain@getcore.me')) {
    return json({ received: true }, { status: 200 });
  }
  const senderEmail = extractEmail(from);

  // Look up user by email
  const user = await getUserByEmail(senderEmail);
  if (!user) {
    logger.warn("Email from unknown sender", { from: senderEmail });
    return json({ received: true }, { status: 200 });
  }

  // Get user's workspace
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: { userId: user.id },
  });

  if (!userWorkspace) {
    logger.warn("User has no workspace", { userId: user.id });
    return json({ received: true }, { status: 200 });
  }

  // Return 200 immediately, process in background

  try {
    const resend = new Resend(env.RESEND_API_KEY);

    // Fetch email body from Resend API
    const emailDetails = await resend.emails.receiving.get(email_id);

    const { html, text } = emailDetails.data || {};

    const messageContent = text || html || "";
    if (!messageContent) {
      logger.warn("Empty email body", { emailId: email_id });
      return;
    }

    const { responseText } = await processInboundMessage({
      userId: user.id,
      workspaceId: userWorkspace.workspaceId,
      channel: "email",
      userMessage: messageContent,
    });

    await sendPlainTextEmail({
      to: senderEmail,
      replyTo: env.FROM_EMAIL,
      subject: `Re: ${subject ?? ""}`,
      text: responseText,
    });
  } catch (err) {
    logger.error("Email message processing failed", {
      userId: user.id,
      error: String(err),
    });
  }


  return json({ received: true }, { status: 200 });
}
