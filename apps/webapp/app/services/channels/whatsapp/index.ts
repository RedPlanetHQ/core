import type { ChannelHandler } from "../types";
import { parseInbound } from "./inbound";
import { sendReply } from "./outbound";
import { WHATSAPP_FORMAT } from "./format";

export const whatsappChannel: ChannelHandler = {
  slug: "whatsapp",
  parseInbound,
  sendReply,
  getFormat: () => WHATSAPP_FORMAT,
  emptyResponse: () =>
    new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } },
    ),
};
