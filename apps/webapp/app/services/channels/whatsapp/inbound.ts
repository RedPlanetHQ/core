import {
  getUserByPhone,
  getUserWorkspaceByWorkspace,
} from "~/models/user.server";
import { prisma } from "~/db.server";
import { verifyTwilioSignature, type TwilioCredentials } from "./client";
import { logger } from "~/services/logger.service";
import type { InboundAttachment, InboundParseResult } from "../types";
import { env } from "~/env.server";

/**
 * Look up the WhatsApp channel for an incoming message by the caller's phone number.
 * Returns the channel's Twilio credentials (from config if custom, else env fallback)
 * and the workspaceId.
 */
async function resolveChannel(
  fromPhone: string,
): Promise<{ creds: TwilioCredentials; workspaceId: string } | null> {
  const channel = await prisma.channel.findFirst({
    where: {
      type: "whatsapp",
      isActive: true,
      config: {
        path: ["phone_number"],
        equals: fromPhone,
      },
    },
    orderBy: { isDefault: "desc" },
  });

  if (channel) {
    const config = channel.config as Record<string, string>;
    const accountSid = config.account_sid ?? env.TWILIO_ACCOUNT_SID;
    const authToken = config.auth_token ?? env.TWILIO_AUTH_TOKEN;
    const whatsappNumber = config.whatsapp_number ?? env.TWILIO_WHATSAPP_NUMBER;

    if (accountSid && authToken && whatsappNumber) {
      return {
        creds: { accountSid, authToken, whatsappNumber },
        workspaceId: channel.workspaceId,
      };
    }
  }

  return null;
}

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

  // Resolve channel and credentials by caller's phone number
  const resolved = await resolveChannel(from);
  if (!resolved) {
    logger.warn(
      "No WhatsApp channel or Twilio credentials for incoming message",
      { from },
    );
    return {};
  }

  // Verify Twilio signature
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const url = new URL(request.url);
  const fullUrl = url.origin + url.pathname;

  if (
    !verifyTwilioSignature(fullUrl, params, signature, resolved.creds.authToken)
  ) {
    logger.warn("Invalid Twilio signature", { from });
    return {};
  }

  const userWorkspace = await getUserWorkspaceByWorkspace(resolved.workspaceId);

  if (!resolved.workspaceId) {
    logger.warn("User has no workspace");
    return {};
  }

  // Download any media attachments from Twilio
  const attachments: InboundAttachment[] = [];
  if (numMedia > 0) {
    const basicAuth = Buffer.from(
      `${resolved.creds.accountSid}:${resolved.creds.authToken}`,
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
      userId: userWorkspace?.userId as string,
      workspaceId: resolved.workspaceId,
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
