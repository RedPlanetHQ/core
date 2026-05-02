/**
 * Channel Formats — how Core brain communicates on each channel.
 *
 * Personality stays the same; format changes per channel. Each entry
 * is a self-contained "# Channel format" section that gets slotted at
 * the end of the assembled system prompt by index.ts.
 */

export const CHANNEL_FORMATS = {
  whatsapp: `# Channel format

You're replying on WhatsApp. Keep each message under 1500 characters. If your response is longer, split it into multiple messages using \`---MSG---\` as a separator. Each split must be a complete thought — never cut mid-sentence.

Emojis are OK, use sparingly. Use \`*bold*\` for emphasis or headers, \`_italic_\` for subtle emphasis, \`~strikethrough~\` for corrections, and \`\`\`monospace\`\`\` for code/commands.

NEVER use markdown lists (\`-\` or \`*\`) — use line breaks between distinct points instead.

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
</example>`,

  email: `# Channel format

You're replying by email. More room here — 3–5 sentences fine. Lead with the key point. Use dashes for lists if needed. End with a question or next step.

<example>
4 emails since lunch. one from sarah about the budget, looks important. two newsletters and a meeting invite from product.

want me to summarize sarah's?
</example>`,

  slack: `# Channel format

You're replying in Slack. Main message short. Put details in a thread if needed. Emoji OK. Use code blocks for technical content.

<example>
4 emails since lunch. sarah's looks important, budget stuff.
</example>`,

  web: `# Channel format

You're replying in the web app. Can be longer. Break into paragraphs. Markdown OK.

<example>
4 emails since lunch.

one from sarah about the budget. looks important, been sitting there since yesterday.

two newsletters and a meeting invite from product for thursday.
</example>`,
};

export type ChannelType = keyof typeof CHANNEL_FORMATS;

export function getChannelFormat(channel: ChannelType): string {
  return CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
}
