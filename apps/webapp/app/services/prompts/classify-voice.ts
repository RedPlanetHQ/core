/**
 * Classify Voice Aspects Prompt
 *
 * Step 3a: Classifies voice facts into specific aspect types.
 * Input: voice_facts from comprehend-evaluate
 * Output: classified voice aspects (Directive, Preference, Habit, Belief, Goal, Task)
 */

import { type ModelMessage } from "ai";
import z from "zod";
import { VOICE_ASPECTS } from "@core/types";

export const ClassifiedVoiceAspectSchema = z.object({
  fact: z.string().describe("The voice fact (preserved as-is from input)"),
  aspect: z.enum(VOICE_ASPECTS).nullable().describe("Voice aspect classification, or null if the fact doesn't fit any category"),
});

export const ClassifyVoiceSchema = z.object({
  aspects: z
    .array(ClassifiedVoiceAspectSchema)
    .describe("Classified voice aspects"),
});

export type ClassifyVoiceResult = z.infer<typeof ClassifyVoiceSchema>;

export const classifyVoicePrompt = (
  voiceFacts: Array<{ fact: string }>,
): ModelMessage[] => {
  const sysPrompt = `You classify voice facts into one of 6 aspect types (or null).

These classifications determine how agents find this fact. An agent asking "what are the user's preferences?" will only see facts classified as Preference. Getting the classification right is critical for recall.

Read the fact. Understand what it means. Pick the aspect that best describes what the fact IS ABOUT.

## Aspects

**Directive** — A standing instruction to a system/agent/automation. Rules that should be followed going forward — not one-time requests.
- "Always scan Gmail in morning sync, exclude newsletters" → Directive
- "Notify me when CPU > 80%" → Directive
- "Ignore test environment webhook events" → Directive
NOT: one-time session requests or personal taste without a system instruction.

**Preference** — HOW the user wants things done. Personal taste about style, format, approach — not a value judgment about the world.
- "I prefer short bullet points over long paragraphs" → Preference
- "Proper Case for email subjects" → Preference
- "Dark mode for all interfaces" → Preference
- "I want feedback on structure/narrative flaws, not grammar" → Preference
NOT: value judgments about how the world works → Belief.

**Habit** — What the user already does REPEATEDLY. Recurring behaviors, routines, practices that are already happening.
- "Takes fish oil supplements daily at breakfast" → Habit
- "Reviews PRs every morning before standup" → Habit
- "I primarily use credit cards for spending, about 80% of transactions" → Habit
NOT: something the user WANTS to start but isn't doing yet → Goal.

**Belief** — A lasting value judgment or principle. Convictions about how the world works — not personal style preferences.
- "Open-source builds more trust than closed products" → Belief
- "Code reviews should focus on architecture, not style" → Belief
- "Small teams move faster than large ones" → Belief
- "I intentionally keep a human in the loop to avoid errors" → Belief
NOT: momentary reactions, opinions about a specific draft, or task feedback.

**Goal** — Something the user is working toward over time. Sustained objectives, targets, aspirations — not one-time asks.
- "I want to run a marathon by December" → Goal
- "Launch the beta this quarter" → Goal
- "I want to personally onboard Guillaume" → Goal
NOT: one-time follow-ups or action items → Task.

**Task** — A one-time commitment the user needs to do. Follow-ups, promises, action items with a clear completion state.
- "Need to send the proposal to the client by Friday" → Task
- "Follow up with the design team about the mockups" → Task
- "I will add Guillaume to the unsubscribe list" → Task
NOT: sustained objectives → Goal. NOT: standing rules for systems → Directive.

**null** — The fact doesn't clearly fit any aspect. It may be noise that slipped through extraction, a product description, or a session-specific statement that isn't really the user's voice.
- "CORE's morning brief is pitched as a single daily summary" → null (product description, not user's voice)
- "The assistant should ask Manik to search using the corebrain plugin" → null (session instruction to assistant)

## Rules
- Each fact gets exactly ONE aspect (or null)
- Do NOT modify the fact text — return it exactly as received
- Classify based on WHAT THE FACT MEANS, not keywords in the text
- If a fact doesn't fit any category, return null — do NOT force it into the closest match`;

  const factsFormatted = voiceFacts
    .map((f, i) => `${i + 1}. ${f.fact}`)
    .join("\n");

  const userPrompt = `Classify each voice fact:

${factsFormatted}`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
