import { getUserByPhone } from "~/models/user.server";
import { prisma } from "~/db.server";
import { verifyTwilioSignature } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundAttachment, InboundParseResult } from "../types";
import { env } from "~/env.server";

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
  const numMedia = parseInt(params.NumMedia ?? "0", 10);

  if (!from || (!body && numMedia === 0)) {
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

  // Download any media attachments (images) from Twilio
  const attachments: InboundAttachment[] = [];
  if (numMedia > 0 && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    const basicAuth = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");

    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = params[`MediaUrl${i}`];
      const mimeType =
        params[`MediaContentType${i}`] ?? "application/octet-stream";
      if (!mediaUrl || !mimeType.startsWith("image/")) continue;

      try {
        const res = await fetch(mediaUrl, {
          headers: { Authorization: `Basic ${basicAuth}` },
        });
        if (!res.ok) continue;
        const buffer = await res.arrayBuffer();
        attachments.push({
          data: Buffer.from(buffer).toString("base64"),
          mimeType,
          originalUrl: mediaUrl,
        });
      } catch (err) {
        logger.warn("Failed to download WhatsApp media", {
          mediaUrl,
          error: String(err),
        });
      }
    }
  }

  return {
    message: {
      userId: user.id,
      workspaceId: userWorkspace.workspaceId,
      userMessage: body,
      replyTo: from,
      metadata: {
        channel: "whatsapp",
        ...(params.MessageSid ? { messageSid: params.MessageSid } : {}),
      },
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  };
}
