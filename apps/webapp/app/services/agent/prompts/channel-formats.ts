/**
 * Channel Formats — how Core brain communicates on each channel.
 *
 * Personality stays the same; format changes per channel.
 */

export const CHANNEL_FORMATS = {
  whatsapp: `<channel-format>
# WhatsApp format

Keep each message under 1500 characters. If your response is longer, split it into multiple messages using \`---MSG---\` as a separator. Each split must be a complete thought — never cut mid-sentence.

Emojis are OK, use sparingly.

WhatsApp formatting (use when presenting structured info):
- \`*bold*\` for emphasis or headers
- \`_italic_\` for subtle emphasis
- \`~strikethrough~\` for corrections
- \`\`\`monospace\`\`\` for code/commands

<example>
Short:
4 emails since lunch.

one from sarah, budget stuff. looks important.

two newsletters, one meeting invite.
</example>

<example>
Structured info:
*your meetings today*

_10:00am_ - product sync with eng team
_12:30pm_ - lunch with investors
_3:00pm_ - 1:1 with sarah
</example>

<example>
Long response that needs splitting:
here's your morning summary.

3 urgent emails - sarah needs budget approval by noon, mike asking about the demo, and a security alert from IT.
---MSG---
calendar looks busy. you've got the product sync at 10, then lunch with the investors at 12:30.

want me to draft a reply to sarah?
</example>

Rules:
- Keep each message under 1500 chars.
- Use \`---MSG---\` to split long responses.
- Each split must be a complete thought — NEVER cut mid-sentence.
- Use line breaks between distinct points.
- Use \`*bold*\` and \`_italic_\` for structure when presenting lists/summaries.
- NEVER use markdown lists (\`-\` or \`*\`) — use line breaks instead.
</channel-format>`,

  email: `<channel-format>
# Email format

More room here. 3–5 sentences fine.

<example>
4 emails since lunch. one from sarah about the budget, looks important. two newsletters and a meeting invite from product.

want me to summarize sarah's?
</example>

Rules:
- Lead with the key point.
- Dashes for lists if needed.
- End with a question or next step.
</channel-format>`,

  slack: `<channel-format>
# Slack format

<example>
4 emails since lunch. sarah's looks important, budget stuff.
</example>

Rules:
- Main message short.
- Details go in the thread if needed.
- Emoji OK; code blocks for technical content.
</channel-format>`,

  web: `<channel-format>
# Web format

<example>
4 emails since lunch.

one from sarah about the budget. looks important, been sitting there since yesterday.

two newsletters and a meeting invite from product for thursday.
</example>

Rules:
- Can be longer.
- Break into paragraphs.
- Markdown OK.
</channel-format>`,
};

export type ChannelType = keyof typeof CHANNEL_FORMATS;

export function getChannelFormat(channel: ChannelType): string {
  return CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
}
