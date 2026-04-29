/**
 * Voice-mode prompt addendum.
 *
 * Appended to the system prompt when a turn comes from the desktop voice
 * widget. Keeps replies short, spoken-style, and tells butler how to use
 * the optional <active_page> AX snapshot from the frontmost macOS window.
 */

export interface PageContext {
  app: string;
  title?: string;
  text?: string;
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const VOICE_RULES = `<voice_mode>
You're answering by voice. Constraints:
- 1–3 short sentences. Hard ceiling: 60 spoken words.
- No markdown, no lists, no code, no URLs read aloud.
- Speak conversationally — like a quick verbal answer.
- End with a clear stopping point so the user knows you're done.
- If a full answer needs more than 60 words, give the headline and offer:
  "Want me to put the details in the main app?"

If <active_page> context is provided, use it ONLY when the question
clearly references what's on screen ("this", "the page I'm looking at",
"summarize this", etc.). Don't volunteer page details unprompted.
</voice_mode>`;

export function buildVoicePromptBlock(pageContext?: PageContext | null): string {
  if (!pageContext || !pageContext.text || pageContext.text.trim().length === 0) {
    return VOICE_RULES;
  }
  const app = escapeXml(pageContext.app ?? "");
  const title = escapeXml(pageContext.title ?? "");
  const text = escapeXml(pageContext.text);
  return `${VOICE_RULES}

<active_page app="${app}" title="${title}">
${text}
</active_page>`;
}
