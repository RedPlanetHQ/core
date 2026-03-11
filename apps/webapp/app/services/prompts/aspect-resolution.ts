/**
 * Aspect Resolution Prompt
 *
 * Used by the async aspect-resolution job to decide if a new voice aspect is:
 * A) Duplicate — same thing, different words → keep existing, skip new
 * B) Evolution/update — new version of same rule → invalidate old, save new
 * C) New — different topic → keep both
 */

import { type ModelMessage } from "ai";
import z from "zod";

export const AspectResolutionDecisionSchema = z.object({
  decision: z
    .enum(["duplicate", "evolution", "new"])
    .describe("Whether the new aspect is a duplicate, evolution, or new"),
  reason: z
    .string()
    .describe("Brief explanation for the decision"),
  matched_aspect_id: z
    .string()
    .nullable()
    .describe("UUID of the existing aspect this matches (null if 'new')"),
});

export const AspectResolutionSchema = z.object({
  decisions: z
    .array(AspectResolutionDecisionSchema)
    .describe("One decision per new aspect"),
});

export type AspectResolutionResult = z.infer<typeof AspectResolutionSchema>;

export const aspectResolutionPrompt = (
  newAspects: Array<{ id: string; fact: string; aspect: string }>,
  existingAspects: Array<{ id: string; fact: string; aspect: string; score: number }>,
): ModelMessage[] => {
  const sysPrompt = `You are resolving voice aspect duplicates.

For each NEW aspect, compare it against the EXISTING aspects and decide:

**duplicate** — Same meaning, just different wording. The new one adds nothing.
Example:
- Existing: "Always scan Gmail in morning sync and notify via WhatsApp"
- New: "Morning sync should scan Gmail and send WhatsApp notification"
→ duplicate (same rule, rephrased)

**evolution** — Same topic/rule but updated, expanded, or modified. New replaces old.
Example:
- Existing: "Morning sync: scan gmail, exclude newsletters, check github, notify via whatsapp"
- New: "Morning sync: scan gmail, exclude newsletters and @commenda.io, check github, notify via whatsapp"
→ evolution (added @commenda.io exclusion — new version of same rule)

**new** — Different topic entirely. Both should exist.
Example:
- Existing: "Morning sync: scan gmail, check github, notify via whatsapp"
- New: "Always use bullet points in email summaries"
→ new (completely different topics)

## Rules
- Compare semantics, not exact words
- If aspects are about the same rule/preference/habit but new one has MORE detail → evolution
- If aspects are about the same rule/preference/habit but worded differently with NO new info → duplicate
- If no existing aspect matches → new
- Set matched_aspect_id to the UUID of the existing aspect that matches (for duplicate or evolution)`;

  const existingFormatted = existingAspects.length > 0
    ? existingAspects
        .map(
          (a) =>
            `  [${a.id}] (${a.aspect}, similarity: ${a.score.toFixed(2)}): "${a.fact}"`,
        )
        .join("\n")
    : "  (none)";

  const newFormatted = newAspects
    .map((a) => `  [${a.id}] (${a.aspect}): "${a.fact}"`)
    .join("\n");

  const userPrompt = `## Existing aspects:
${existingFormatted}

## New aspects to resolve:
${newFormatted}

For each new aspect, decide: duplicate, evolution, or new.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
