import { getUserByPhone } from "~/models/user.server";
import { prisma } from "~/db.server";
import { verifyTwilioSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundParseResult } from "../types";

/**
 * Parse a Twilio WhatsApp webhook request into an InboundParseResult.
 */
export async function parseInbound(
  request: Request,
): Promise<InboundParseResult> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  const from = (params.From ?? "").replace("whatsapp:", "");
  const body = params.Body ?? "";

  if (!from || !body) {
    return {};
  }

  // Verify Twilio signature
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const url = new URL(request.url);
  const fullUrl = url.origin + url.pathname;

  if (!verifyTwilioSignature(fullUrl, params, signature)) {
    logger.warn("Invalid Twilio signature", { from });
    return {};
  }

  // Look up user by phone
  const user = await getUserByPhone(from);
  if (!user) {
    logger.warn("WhatsApp message from unknown phone", { from });
    return { unknownContact: { identifier: from, channel: "whatsapp" } };
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
      userMessage: body,
      replyTo: from,
    },
  };
}
