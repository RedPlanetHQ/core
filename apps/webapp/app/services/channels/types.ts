/**
 * Shared channel types.
 *
 * Every channel (WhatsApp, Email, …) implements ChannelHandler so the
 * rest of the codebase can treat them uniformly.
 */

export interface ChannelHandler {
  slug: string;
  parseInbound(request: Request): Promise<InboundMessage | null>;
  sendReply(to: string, text: string, metadata?: ReplyMetadata): Promise<void>;
  getFormat(): string;
  emptyResponse(): Response;
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
