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

const VOICE_INSTRUCTIONS = `You give the user a one-breath spoken catchup, butler-style. Think a head-nod across the room, not a briefing.

Rules:
- Lead with a quick inventory of WHAT'S WAITING — name the kinds of items, not the count alone. E.g. "Your morning brief, sir, and two new GitHub issues." Not "Three things…", not "Here's an update…".
- Then exactly ONE short sentence per item or per group. ≤ 15 words each. The most actionable fact — what it is and why the user might care. No lead-up, no follow-up.
- Group ruthlessly. Multiple emails from one sender → one line. Multiple issues on one repo → one line. Don't list them individually.
- Identify items by source / sender / issue number / task title — whatever names them in one phrase. Drop URLs, IDs, code blocks, markdown, filler words.
- Total length: 2 to 4 sentences. Hard ceiling. If you're tempted to add a fifth, group harder.
- No greeting beyond the "sir" address. No sign-off. No "here's a summary". No transition phrases ("also", "in addition", "meanwhile").
- Optional one-clause invitation at the very end if there's a clear ask: "tell me which to dig into" or "say the word and I'll expand". Skip otherwise.
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
