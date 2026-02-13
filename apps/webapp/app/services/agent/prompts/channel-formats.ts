/**
 * Channel Formats
 *
 * Defines HOW Corebrain communicates on each channel.
 * Personality stays the same, format changes.
 */

export const CHANNEL_FORMATS = {
  whatsapp: `<channel-format>
WhatsApp format:

Keep each message under 1500 characters. If your response is longer, split it into multiple messages using "---MSG---" as separator between messages. Each split should be a complete thought - never cut mid-sentence.

Emojis ok, use sparingly.

WhatsApp formatting (use when presenting structured info):
- *bold* for emphasis or headers
- _italic_ for subtle emphasis
- ~strikethrough~ for corrections
- \`monospace\` for code/commands

Example (short):
4 emails since lunch.

one from sarah, budget stuff. looks important.

two newsletters, one meeting invite.

Example (structured info):
*your meetings today*

_10:00am_ - product sync with eng team
_12:30pm_ - lunch with investors
_3:00pm_ - 1:1 with sarah

Example (long response that needs splitting):
here's your morning summary.

3 urgent emails - sarah needs budget approval by noon, mike asking about the demo, and a security alert from IT.
---MSG---
calendar looks busy. you've got the product sync at 10, then lunch with the investors at 12:30.

want me to draft a reply to sarah?

Rules:
- keep each message under 1500 chars
- use "---MSG---" to split long responses
- each split must be complete thought, never mid-sentence
- use line breaks between distinct points
- use *bold* and _italic_ for structure when presenting lists/summaries
- no markdown lists (- or *), use line breaks instead
</channel-format>`,

  email: `<channel-format>
Email format:

More room here. 3-5 sentences fine.

Example:
4 emails since lunch. one from sarah about the budget, looks important. two newsletters and a meeting invite from product.

want me to summarize sarah's?

Rules:
- key point first
- dashes for lists if needed
- end with question or next step
</channel-format>`,

  slack: `<channel-format>
Slack format:

Example:
4 emails since lunch. sarah's looks important, budget stuff.

Rules:
- main message short
- details in thread if needed
- emoji ok, code blocks for technical
</channel-format>`,

  web: `<channel-format>
Web format:

Example:
4 emails since lunch.

one from sarah about the budget. looks important, been sitting there since yesterday.

two newsletters and a meeting invite from product for thursday.

Rules:
- can be longer
- break into paragraphs
- markdown ok
</channel-format>`,
};

export type ChannelType = keyof typeof CHANNEL_FORMATS;

export function getChannelFormat(channel: ChannelType): string {
  return CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
}
