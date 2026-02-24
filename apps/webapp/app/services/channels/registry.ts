import type { ChannelHandler } from "./types";
import { whatsappChannel } from "./whatsapp";
import { emailChannel } from "./email";
import { slackChannel } from "./slack";

const channels: Record<string, ChannelHandler> = {
  whatsapp: whatsappChannel,
  email: emailChannel,
  slack: slackChannel,
};

export type ChannelSlug = keyof typeof channels;

export function getChannel(slug: string): ChannelHandler {
  const handler = channels[slug];
  if (!handler) {
    throw new Error(`Unknown channel: ${slug}`);
  }
  return handler;
}

export function getAllChannelSlugs(): string[] {
  return Object.keys(channels);
}
