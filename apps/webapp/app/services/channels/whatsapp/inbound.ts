import { getUserByPhone } from "~/models/user.server";
import { prisma } from "~/db.server";
import { verifyTwilioSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundMessage } from "../types";

/**
 * Parse a Twilio WhatsApp webhook request into an InboundMessage.
 * Returns null when the request is invalid, unverified, or from an unknown user.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundMessage | null> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  const from = (params.From ?? "").replace("whatsapp:", "");
  const body = params.Body ?? "";

  if (!from || !body) {
    return null;
  }

  // Verify Twilio signature
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const url = new URL(request.url);
  const fullUrl = url.origin + url.pathname;

  if (!verifyTwilioSignature(fullUrl, params, signature)) {
    logger.warn("Invalid Twilio signature", { from });
    return null;
  }

  // Look up user by phone
  const user = await getUserByPhone(from);
  if (!user) {
    logger.warn("WhatsApp message from unknown phone", { from });
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
    userMessage: body,
    replyTo: from,
  };
}
