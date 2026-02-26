import type { ChannelHandler } from "../types";
import { parseInbound } from "./inbound";
import { sendReply } from "./outbound";
import { sendWhatsAppTypingIndicator } from "./client";
import { WHATSAPP_FORMAT } from "./format";

export const whatsappChannel: ChannelHandler = {
  slug: "whatsapp",
  capabilities: {
    sendAcknowledgeMessage: true,
    sendTypingIndicator: true,
  },
  parseInbound,
  sendReply,
  getFormat: () => WHATSAPP_FORMAT,
  emptyResponse: () =>
    new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } },
    ),
  async sendTypingIndicator(metadata) {
    const messageSid = metadata?.messageSid;
    if (messageSid) {
      await sendWhatsAppTypingIndicator(messageSid);
    }
  },
};
