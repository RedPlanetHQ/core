/**
 * Shared channel types.
 *
 * Every channel (WhatsApp, Email, …) implements ChannelHandler so the
 * rest of the codebase can treat them uniformly.
 */

export interface InboundParseResult {
  message?: InboundMessage;
  /** When user is not found, contains the contact info to send an invite */
  unknownContact?: {
    identifier: string; // phone, email, slack user ID
    channel: string; // "whatsapp" | "email" | "slack"
    metadata?: Record<string, string>; // e.g. slackChannel, threadTs, botToken
  };
}

export interface ChannelCapabilities {
  /** Whether the agent should send an intermediate ack message before long operations */
  sendAcknowledgeMessage: boolean;
  /** Whether the channel supports a typing/processing indicator */
  sendTypingIndicator: boolean;
}

export interface ChannelHandler {
  slug: string;
  capabilities: ChannelCapabilities;
  parseInbound(request: Request): Promise<InboundParseResult>;
  sendReply(to: string, text: string, metadata?: ReplyMetadata): Promise<void>;
  getFormat(): string;
  emptyResponse(): Response;
  /** Send a typing/processing indicator. Only called if capabilities.sendTypingIndicator is true. */
  sendTypingIndicator?(metadata?: Record<string, string>): Promise<void>;
}

export interface InboundMessage {
  userId: string;
  workspaceId: string;
  userMessage: string;
  replyTo: string; // phone number, email address, etc.
  metadata?: Record<string, string>; // e.g. { subject: "Re: ..." }
}

export interface ReplyMetadata {
  workspaceId?: string;
  subject?: string;
  [key: string]: unknown;
}
