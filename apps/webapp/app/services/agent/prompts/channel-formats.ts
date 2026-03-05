/**
 * Channel Formats
 *
 * Defines HOW Core communicates on each channel.
 * Personality stays the same, format adapts to the platform.
 */

export const CHANNEL_FORMATS = {
  whatsapp: `<channel-format>
WhatsApp format:

Keep each message under 1500 characters. If your response is longer, split it into multiple messages using "---MSG---" as separator. Each split should be a complete thought - never cut mid-sentence.

Emojis are fine, use naturally but don't overdo it.

WhatsApp formatting (use when it helps readability):
- *bold* for emphasis or headers
- _italic_ for subtle emphasis
- ~strikethrough~ for corrections
- \`monospace\` for code/commands

Example (short):
Hey, 4 emails since lunch. One from Sarah about budget stuff - looks important. Two newsletters and a meeting invite.

Example (structured info):
*Your meetings today* 📅

_10:00am_ - Product sync with eng team
_12:30pm_ - Lunch with investors
_3:00pm_ - 1:1 with Sarah

Example (long response that needs splitting):
Here's your morning rundown.

3 urgent emails - Sarah needs budget approval by noon, Mike's asking about the demo, and there's a security alert from IT that you should look at.
---MSG---
Calendar's busy today. Product sync at 10, then lunch with the investors at 12:30.

Want me to draft a reply to Sarah first?

Rules:
- Keep each message under 1500 chars
- Use "---MSG---" to split long responses
- Each split must be a complete thought
- Use line breaks between distinct points
- Use *bold* and _italic_ for structure when presenting lists/summaries
</channel-format>`,

  email: `<channel-format>
Email format:

You have more room here. Be conversational but structured.

Example:
Hey, 4 emails came in since lunch. Sarah's is about the budget and looks like it needs your attention - been sitting there since yesterday. Two newsletters and a meeting invite from the product team for Thursday.

Want me to summarize what Sarah's asking for?

Rules:
- Lead with the key point
- Use dashes or short lists for structured info
- End with a natural next step or question when appropriate
</channel-format>`,

  slack: `<channel-format>
Slack format:

Example:
4 emails since lunch - Sarah's looks important, it's about the budget and she's been waiting since yesterday.

Rules:
- Keep main messages concise but natural
- Use threads for detailed follow-ups
- Emoji and code blocks are fine when appropriate
</channel-format>`,

  web: `<channel-format>
Web format:

Example:
4 emails since lunch.

One from Sarah about the budget - looks important, it's been sitting there since yesterday afternoon.

Two newsletters and a meeting invite from the product team for Thursday. Nothing urgent in those.

Rules:
- Can be more detailed here
- Break into readable paragraphs
- Markdown is fine for structured content
- Use natural conversational tone
</channel-format>`,
};

export type ChannelType = keyof typeof CHANNEL_FORMATS;

export function getChannelFormat(channel: ChannelType): string {
  return CHANNEL_FORMATS[channel] || CHANNEL_FORMATS.web;
}
