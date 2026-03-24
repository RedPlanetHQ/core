import type { ChannelHandler } from "../types";
import { parseInbound } from "./inbound";
import { sendReply } from "./outbound";
import { TELEGRAM_FORMAT } from "./format";

export const telegramChannel: ChannelHandler = {
  slug: "telegram",
  capabilities: {
    sendAcknowledgeMessage: false,
    sendTypingIndicator: false,
  },
  parseInbound,
  sendReply,
  getFormat: () => TELEGRAM_FORMAT,
  emptyResponse: () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
};
