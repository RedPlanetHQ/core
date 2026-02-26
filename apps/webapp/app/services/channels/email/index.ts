import type { ChannelHandler } from "../types";
import { parseInbound } from "./inbound";
import { sendReply } from "./outbound";
import { EMAIL_FORMAT } from "./format";

export const emailChannel: ChannelHandler = {
  slug: "email",
  capabilities: {
    sendAcknowledgeMessage: false,
    sendTypingIndicator: false,
  },
  parseInbound,
  sendReply,
  getFormat: () => EMAIL_FORMAT,
  emptyResponse: () =>
    new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
};
