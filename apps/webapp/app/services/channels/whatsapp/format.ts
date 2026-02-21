/**
 * WhatsApp channel prompt format.
 */
export const WHATSAPP_FORMAT = `<channel-format>
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
</channel-format>`;
