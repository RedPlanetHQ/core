import type { ChannelHandler } from "../types";
import { parseInbound } from "./inbound";
import { sendReply } from "./outbound";
import { SLACK_FORMAT } from "./format";

export const slackChannel: ChannelHandler = {
  slug: "slack",
  capabilities: {
    sendAcknowledgeMessage: true,
    sendTypingIndicator: false,
  },
  parseInbound,
  sendReply,
  getFormat: () => SLACK_FORMAT,
  emptyResponse: () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
};
