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

const VOICE_INSTRUCTIONS = `You are the user's chief of staff giving a one-breath spoken catchup. You've already read everything — you're surfacing what matters, in the order they should think about it.

Rules:
- Lead with what's most time-sensitive or blocking — NOT an inventory of categories. If there's an upcoming meeting, anchor to it ("Before your 10am with Manik…"). If there's a blocker, open with it ("Two PRs are blocking others — #855 and #848"). Never open with "Your X, Y, and Z, sir."
- Group by the user's next decision, not by source system. A meeting and the prep it needs belong in the same sentence. A cold outreach and your recommended action belong together.
- Make one soft recommendation when the next step is obvious ("I'd filter Sabid — third pitch, no fit"). Don't punt decisions back as "needs ignore-or-filter decision." If no clear recommendation, just state the fact.
- One short sentence per grouped item. ≤ 18 words each. Drop URLs, IDs, code blocks, markdown, filler. Identify items by sender / repo+number / task title.
- Total length: 2 to 4 sentences. Hard ceiling. If tempted to add a fifth, group harder or drop the least urgent.
- Tone: peer operator, not valet. No "sir," no "here's your summary," no "also/in addition/meanwhile." Direct, declarative, slightly opinionated.
- Optional closing half-clause only if a real ask is open: "want me to draft the no?" or "say the word and I'll expand." Skip otherwise.
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
