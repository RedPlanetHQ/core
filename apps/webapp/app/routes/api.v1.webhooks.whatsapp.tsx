/**
 * WhatsApp Webhook (Twilio)
 *
 * Public endpoint — no auth, verified via Twilio signature.
 * Parses inbound WhatsApp messages, runs agent pipeline, sends response.
 */

import { type ActionFunctionArgs, json } from "@remix-run/node";
import { getUserByPhone } from "~/models/user.server";
import { prisma } from "~/db.server";
import {
  sendWhatsAppMessage,
  verifyTwilioSignature,
} from "~/services/whatsapp.server";
import { processInboundMessage } from "~/services/agent/message-processor";
import { logger } from "~/services/logger.service";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Parse Twilio form data
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  const from = (params.From ?? "").replace("whatsapp:", "");
  const body = params.Body ?? "";
  const numMedia = parseInt(params.NumMedia ?? "0", 10);

  if (!from || !body) {
    return json({ error: "Missing From or Body" }, { status: 400 });
  }

  // Verify Twilio signature
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const url = new URL(request.url);
  const fullUrl = url.origin + url.pathname;

  if (!verifyTwilioSignature(fullUrl, params, signature)) {
    logger.warn("Invalid Twilio signature", { from });
    return json({ error: "Invalid signature" }, { status: 403 });
  }

  // Look up user by phone
  const user = await getUserByPhone(from);
  if (!user) {
    logger.warn("WhatsApp message from unknown phone", { from });
    // Return 200 with empty TwiML to avoid Twilio retries
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      },
    );
  }

  // Get user's workspace
  const userWorkspace = await prisma.userWorkspace.findFirst({
    where: { userId: user.id },
  });

  if (!userWorkspace) {
    logger.warn("User has no workspace", { userId: user.id });
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      },
    );
  }

  // Return 200 immediately with empty TwiML (Twilio expects fast response)
  // Process message in background
  processInboundMessage({
    userId: user.id,
    workspaceId: userWorkspace.workspaceId,
    channel: "whatsapp",
    userMessage: body,
  })
    .then(async ({ responseText }) => {
      await sendWhatsAppMessage(from, responseText);
    })
    .catch((err) => {
      logger.error("WhatsApp message processing failed", {
        userId: user.id,
        error: String(err),
      });
    });

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    },
  );
}
