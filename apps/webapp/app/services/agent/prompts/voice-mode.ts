/**
 * Voice-widget prompt addendums.
 *
 * Two independent blocks that get conditionally appended to butler's
 * system prompt for turns coming from the desktop voice widget:
 *
 *   - buildVoiceConstraintsBlock()   → voice mode only (terse spoken style)
 *   - buildActivePageBlock(ctx)      → both modes when AX text was captured
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

export function buildVoiceConstraintsBlock(): string {
  return VOICE_RULES;
}

export function buildActivePageBlock(
  pageContext?: PageContext | null,
): string | null {
  if (!pageContext || !pageContext.text || pageContext.text.trim().length === 0) {
    return null;
  }
  const app = escapeXml(pageContext.app ?? "");
  const title = escapeXml(pageContext.title ?? "");
  const text = escapeXml(pageContext.text);
  return `<active_page app="${app}" title="${title}">
${text}
</active_page>

The <active_page> block above is a snapshot of the user's frontmost
macOS window at the time of this message. Use it when the question
references "this", "what I'm looking at", "summarize this", etc. Don't
volunteer page details unprompted — it's context, not the topic.`;
}

/** Back-compat for callers that want voice rules + active page in one shot. */
export function buildVoicePromptBlock(
  pageContext?: PageContext | null,
): string {
  const page = buildActivePageBlock(pageContext);
  return page ? `${VOICE_RULES}\n\n${page}` : VOICE_RULES;
}
