import { Resend } from "resend";
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

  // Find the recipient address that is a getcore.me agent email
  const agentAddress = to?.find((addr) => addr.endsWith("@getcore.me"));
  if (!agentAddress) {
    return {};
  }

  // Derive workspace slug from the agent email (e.g. "harshith@getcore.me" → "harshith")
  const workspaceSlug = agentAddress.split("@")[0];

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

  // Look up workspace by slug
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    include: {
      UserWorkspace: { take: 1 },
    },
  });

  if (!workspace) {
    logger.warn("No workspace found for agent email", { agentAddress });
    return {};
  }

  const userWorkspace = workspace.UserWorkspace[0];
  if (!userWorkspace) {
    logger.warn("Workspace has no users", { workspaceSlug });
    return {};
  }

  return {
    message: {
      userId: userWorkspace.userId,
      workspaceId: workspace.id,
      userMessage: messageContent,
      replyTo: senderEmail,
      metadata: { subject: subject ?? "", agentEmail: agentAddress },
    },
  };
}
