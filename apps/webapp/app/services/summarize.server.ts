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

const VOICE_INSTRUCTIONS = `You give the user a quick spoken catchup, butler-style. Think "here's where things stand, sir" — not a recital of every message.

Rules:
- 1 to 3 short spoken sentences total. Be brief.
- List items as short noun phrases (3 to 6 words each). Connect them naturally with commas or short conjunctions — don't say "one, two, three".
- Lead with the count when there are several items ("Three things…") OR with the most important one.
- Use task titles only when essential to disambiguate. Drop URLs, IDs, code, markdown, and filler words.
- When something might warrant more detail, end with a single short invitation like "ask me to expand on any of these" or "let me know if you want details on the X". Skip this entirely for trivial one-item catchups.
- No greeting, no sign-off, no "here's a summary", no transition phrases like "also" or "in addition".
- Output the catchup text only. Nothing else.`;

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
