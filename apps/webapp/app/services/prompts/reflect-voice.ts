/**
 * Reflect Voice Prompt
 *
 * A quality filter pass that runs AFTER extract-voice and BEFORE classify-voice.
 * Removes session noise — conversational replies, one-time task instructions,
 * session-specific observations — that slipped through extraction.
 *
 * The filter is intentionally conservative: when in doubt, remove.
 * False negatives (removing a real fact) are cheaper than false positives (storing noise).
 */

import { type ModelMessage } from "ai";
import z from "zod";

const ReflectedVoiceFactSchema = z.object({
  fact: z
    .string()
    .describe("Complete statement preserving user's intent"),
});

export const ReflectVoiceSchema = z.object({
  voice_facts: z
    .array(ReflectedVoiceFactSchema)
    .describe("Filtered voice facts — only durable, session-independent facts"),
});

export type ReflectVoiceResult = z.infer<typeof ReflectVoiceSchema>;

export const reflectVoicePrompt = (
  voice_facts: Array<{ fact: string }>,
): ModelMessage[] => {
  const sysPrompt = `You are a quality filter for a user's digital brain.

You receive candidate voice facts extracted from a conversation. Your job: REMOVE facts that are session-specific noise. Keep only facts a different agent would still find useful tomorrow.

## REMOVE — these expire with the session

**Conversational replies and acknowledgments:**
- "Go ahead", "Yes", "OK", "Continue", "Sounds good", "That's right"
- "Input is already there", "It's already done", "That looks correct", "Got it"
- Any short reply that only makes sense in the context of the current exchange

**Session navigation instructions:**
- "Harshith directed attention to file X for implementation"
- "Look at the X branch for the implementation"
- References to a specific file, branch, or PR that only matter for the current task

**One-time task requests and in-session feature asks:**
- "Harshith suggested adding a timestamp-based filter (in addition to date-based filtering)"
- "Harshith wanted a single git commit containing the current changes"
- Requests phrased as what the user "wanted" or "suggested" for current in-progress work

**Implementation instructions for a single task:**
- "If the Slack message parser cannot cover all block cases, it should return the full blocks JSON"
- "When using the last email as reference point for next sync, add a 10-second buffer"
- "The activity field lastSyncTime should be stored based on the last email read"
- Specific technical decisions for one task that are not standing rules

**Anything only meaningful TODAY:**
- Facts that reference a specific in-flight artifact (a draft, a PR, a file being edited)
- Facts that make no sense without knowing what the session was about

## KEEP — these last beyond the session

- **Standing rules**: "Scan Gmail every morning, skip newsletters, notify via WhatsApp"
- **Preferences**: "I prefer short bullet points, not long paragraphs"
- **Habits**: "I review finances every Sunday"
- **Beliefs**: "Small teams ship faster than large ones"
- **Goals**: "I want to launch the beta this quarter"
- **Durable tasks**: "Need to call the lawyer about the trademark before Friday"
- **Standing principles**: "Always follow existing codebase patterns and don't add new dependencies"

## THE TEST

Ask: "If a DIFFERENT agent talks to this user TOMORROW with no memory of today's session, would this fact still be useful and clear?"

- "Go ahead" → meaningless without today's context → **REMOVE**
- "Input is already there" → meaningless without today's context → **REMOVE**
- "Suggested adding a timestamp filter" → tied to today's task → **REMOVE**
- "If the Slack parser cannot cover block cases, return blocks JSON" → specific to today's task → **REMOVE**
- "Prefer bullet points" → useful to any agent → **KEEP**
- "Never schedule meetings before 10am" → useful to any agent → **KEEP**

Return only the facts that pass the test. When uncertain, REMOVE.`;

  const factsFormatted = voice_facts
    .map((f, i) => `${i + 1}. ${f.fact}`)
    .join("\n");

  const userPrompt = `Review these candidate voice facts and remove any that are session-specific noise.

<candidate_facts>
${factsFormatted}
</candidate_facts>

Return only the facts that represent durable, lasting knowledge about the user.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
