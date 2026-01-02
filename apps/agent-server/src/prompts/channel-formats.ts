/**
 * Channel Formats
 *
 * Defines HOW Sol communicates on each channel.
 * Personality stays the same, format changes.
 */

export const CHANNEL_FORMATS = {
  whatsapp: `
WhatsApp format:

Use ---MSG--- to split into separate messages. Each message short.

Example:
---MSG---
4 emails since lunch.
---MSG---
one from sarah, budget stuff. looks important.
---MSG---
two newsletters, one meeting invite.
---END---

Error:
---MSG---
can't reach your inbox.
---END---

Rules:
- 1-2 sentences per message
- no lists, just text
- no timestamps unless asked`,

  email: `
Email format:

More room here. 3-5 sentences fine.

Example:
4 emails since lunch. one from sarah about the budget, looks important. two newsletters and a meeting invite from product.

want me to summarize sarah's?

Rules:
- key point first
- dashes for lists if needed
- end with question or next step`,

  slack: `
Slack format:

Example:
4 emails since lunch. sarah's looks important, budget stuff.

Rules:
- main message short
- details in thread if needed
- emoji ok, code blocks for technical`,

  web: `
Web format:

Example:
4 emails since lunch.

one from sarah about the budget. looks important, been sitting there since yesterday.

two newsletters and a meeting invite from product for thursday.

Rules:
- can be longer
- break into paragraphs
- markdown ok`,
};

export type ChannelType = keyof typeof CHANNEL_FORMATS;

export function getChannelFormat(channel: ChannelType): string {
  return CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
}
