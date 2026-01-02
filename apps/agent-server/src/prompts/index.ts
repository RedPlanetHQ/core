/**
 * Prompt Builder
 *
 * Two-layer architecture:
 * - Sol: personality + channel format (synthesis only)
 * - Orchestrator: no personality, gathers context
 */

import { SOL_PERSONALITY } from './sol-personality';
import { CHANNEL_FORMATS, ChannelType } from './channel-formats';

/**
 * Get Sol's prompt for synthesizing responses.
 * Combines personality (who Sol is) + channel format (how to communicate).
 * Sol receives context from orchestrator and just needs to respond.
 */
export function getSolPrompt(channel: ChannelType): string {
  const channelFormat = CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
  return `${SOL_PERSONALITY}\n\n${channelFormat}`;
}

// Re-export for convenience
export { SOL_PERSONALITY } from './sol-personality';
export { CHANNEL_FORMATS, ChannelType } from './channel-formats';
