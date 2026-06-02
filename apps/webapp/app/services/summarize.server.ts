/**
 * Common summariser. Takes arbitrary text and produces a tight summary
 * tuned for a delivery mode:
 *
 *   - "voice"  : 1–2 spoken sentences, conversational, no markdown,
 *                no greeting/sign-off. Drives the Mac voice pill readout.
 *   - "text"   : a concise paragraph; can use light structure (lists, bold)
 *                when it improves scannability.
 *
 * Uses the project's "low" complexity chat model (Haiku-equivalent), wrapped
 * via createAgent so caching/BYOK routing applies the same way as other
 * lightweight calls in the codebase.
 */

import { createAgent, resolveModelString } from "~/lib/model.server";
import { logger } from "~/services/logger.service";

export type SummarizeMode = "voice" | "text";

const VOICE_INSTRUCTIONS = `You summarise messages for spoken playback through a Mac voice pill.

Rules:
- One sentence preferred, never more than two. Be ruthless about brevity.
- Lead with the most actionable item. The user is listening passively — they need to know what to do next.
- Group related items. Same task / same sender → one mention with a count.
- Use task titles only when essential to disambiguate. Drop URLs, IDs, code, markdown, and filler.
- No greeting, no sign-off, no "here's a summary", no transition phrases like "also" or "in addition".
- Output the summary text only. Nothing else.`;

const TEXT_INSTRUCTIONS = `You summarise messages for on-screen display.

Rules:
- Output a concise paragraph. A short bulleted list is fine if it reads better.
- Keep task titles, drop URLs and IDs unless they're essential.
- No greeting, no sign-off. Just the summary itself.`;

export async function summarize(params: {
  text: string;
  mode: SummarizeMode;
}): Promise<string> {
  const { text, mode } = params;

  const trimmed = text.trim();
  if (!trimmed) return "";

  const instructions =
    mode === "voice" ? VOICE_INSTRUCTIONS : TEXT_INSTRUCTIONS;

  try {
    const modelString = await resolveModelString("chat", "low");
    const agent = createAgent(modelString, instructions);
    const { text: out } = await agent.generate(trimmed);
    return (out ?? "").trim();
  } catch (error) {
    logger.warn("[summarize] LLM call failed, returning raw text", { error });
    return trimmed;
  }
}
