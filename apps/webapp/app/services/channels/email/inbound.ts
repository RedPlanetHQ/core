import { Resend } from "resend";
import { getUserByEmail } from "~/models/user.server";
import { prisma } from "~/db.server";
import { env } from "~/env.server";
import { logger } from "~/services/logger.service";
import type { InboundParseResult } from "../types";

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
 * Parse a Resend inbound-email webhook request into an InboundParseResult.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundParseResult> {
  let payload: ResendWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return {};
  }

  // Only handle email.received events
  if (payload.type !== "email.received") {
    return {};
  }

  const { email_id, from, to, subject } = payload.data ?? {};
  if (!email_id || !from) {
    return {};
  }

  // Only process emails addressed to brain@getcore.me
  if (env.FROM_EMAIL && (!to || !to.includes(env.FROM_EMAIL))) {
    return {};
  }

  const senderEmail = extractEmail(from);

  // Fetch email body from Resend API
  const resend = new Resend(env.RESEND_API_KEY);
  const emailDetails = await resend.emails.receiving.get(email_id);
  const { html, text } = emailDetails.data || {};
  const messageContent = text || html || "";

  if (!messageContent) {
    logger.warn("Empty email body", { emailId: email_id });
    return {};
  }

  // Look up user by email
  const user = await getUserByEmail(senderEmail);
  if (!user) {
    logger.warn("Email from unknown sender", { from: senderEmail });
    return { unknownContact: { identifier: senderEmail, channel: "email" } };
  }

  // Get user's workspace
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: { userId: user.id },
  });

  if (!userWorkspace) {
    logger.warn("User has no workspace", { userId: user.id });
    return {};
  }

  return {
    message: {
      userId: user.id,
      workspaceId: userWorkspace.workspaceId,
      userMessage: messageContent,
      replyTo: senderEmail,
      metadata: { subject: subject ?? "" },
    },
  };
}
