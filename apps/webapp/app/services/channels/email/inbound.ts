import { Resend } from "resend";
import { getUserByEmail } from "~/models/user.server";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import type { InboundMessage } from "../types";

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    message_id?: string;
  };
}

/**
 * Extract plain email address from "Name <email>" format.
 */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

/**
 * Parse a Resend inbound-email webhook request into an InboundMessage.
 * Returns null for non-email.received events, unknown senders, or empty bodies.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundMessage | null> {
  let payload: ResendWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return null;
  }

  // Only handle email.received events
  if (payload.type !== "email.received") {
    return null;
  }

  const { email_id, from, to, subject } = payload.data ?? {};
  if (!email_id || !from) {
    return null;
  }

  // Only process emails addressed to brain@getcore.me
  if (env.FROM_EMAIL && (!to || !to.includes(env.FROM_EMAIL))) {
    return null;
  }

  const senderEmail = extractEmail(from);

  // Fetch email body from Resend API
  const resend = new Resend(env.RESEND_API_KEY);
  const emailDetails = await resend.emails.receiving.get(email_id);
  const { html, text } = emailDetails.data || {};
  const messageContent = text || html || "";

  if (!messageContent) {
    logger.warn("Empty email body", { emailId: email_id });
    return null;
  }

  // Look up user by email
  const user = await getUserByEmail(senderEmail);
  if (!user) {
    logger.warn("Email from unknown sender", { from: senderEmail });
    return null;
  }

  // Get user's workspace
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: { userId: user.id },
  });

  if (!userWorkspace) {
    logger.warn("User has no workspace", { userId: user.id });
    return null;
  }

  return {
    userId: user.id,
    workspaceId: userWorkspace.workspaceId,
    userMessage: messageContent,
    replyTo: senderEmail,
    metadata: { subject: subject ?? "" },
  };
}
