/**
 * Reflect Voice Prompt
 *
 * A quality filter pass that runs AFTER extract-voice and BEFORE classify-voice.
 * Removes session noise — conversational replies, one-time task instructions,
 * session-specific observations — that slipped through extraction.
 *
 * Receives the original episode content so it can resolve ambiguous facts
 * (e.g., a rule stated during a task session vs. a one-time instruction).
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
  episodeContent: string,
): ModelMessage[] => {
  const sysPrompt = `A good butler remembers what lasts — not what was said in passing. You are filtering candidate voice facts extracted from a conversation, keeping only what a butler would carry forward. Remove session-specific noise. Keep only what a different agent would still find useful tomorrow.

You receive the original episode so you can verify each fact in context before deciding.

Use the episode to resolve ambiguity — a rule stated during a coding session may still be a standing rule, not a one-time instruction. Check the original text before deciding.

## REMOVE — these expire with the session

**Conversational replies and acknowledgments:**
- "Go ahead", "Yes", "OK", "Continue", "Sounds good", "That's right"
- "Input is already there", "It's already done", "That looks correct", "Got it"
- Any short reply that only makes sense in the context of the current exchange

**Session navigation instructions:**
- "Check the second drawer in the kitchen for the warranty card"
- "Look at the email from Tuesday for the account number"
- References to a specific artifact, location, or message that only matter for the current task

**One-time task requests and in-session feature asks:**
- "Add the guest bedroom to the cleaning schedule for this weekend"
- "Include Sarah's dietary restrictions in the dinner reservation"
- Requests phrased as what the user "wanted" or "suggested" for current in-progress work

**Implementation instructions for a single task:**
- "Use the blue template for this presentation, not the corporate one"
- "When replying to the landlord, mention the leak started last Thursday"
- "Make sure the invoice includes the 10% early payment discount"
- Specific instructions for one task that are not standing rules

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
- "It's already done" → meaningless without today's context → **REMOVE**
- "Include Sarah's dietary restrictions for this dinner" → tied to today's task → **REMOVE**
- "Use the blue template for this presentation" → specific to today's task → **REMOVE**
- "Prefer bullet points" → useful to any agent → **KEEP**
- "Never schedule meetings before 10am" → useful to any agent → **KEEP**

Return only the facts that pass the test. When uncertain, check the episode — if the original text shows a general statement ("always do X"), KEEP. If it's clearly tied to a specific in-progress task, REMOVE.`;

  const factsFormatted = voice_facts
    .map((f, i) => `${i + 1}. ${f.fact}`)
    .join("\n");

  const userPrompt = `Review these candidate voice facts using the original episode as context.

<episode>
${episodeContent}
</episode>

<candidate_facts>
${factsFormatted}
</candidate_facts>

Return only the facts that represent durable, lasting knowledge about the user.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
