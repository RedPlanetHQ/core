/**
 * Scratchpad Decision Prompt
 *
 * Lightweight LLM call that classifies proactive page edits into intents.
 * Receives previous and current page state — LLM diffs and classifies in one step.
 *
 * Input:  previous paragraphs + current paragraphs + connected integrations
 * Output: list of actionable intents with paragraph indices referencing current state
 */

import { z } from "zod";
import { makeStructuredModelCall } from "~/lib/model.server";

// ── Schema ─────────────────────────────────────────────────────────────

export const ScratchpadIntentSchema = z.object({
  intents: z.array(
    z.object({
      /** 1-based indices into the <current_state> list */
      paragraphIndices: z
        .array(z.number())
        .describe("1-based indices from <current_state> that this intent comes from"),
      /** What the user wants done — phrased as a clear instruction for the agent */
      intent: z
        .string()
        .describe(
          "Clear instruction for the butler describing what needs to be done",
        ),
      /** Whether this is actionable (butler can/should act on it) */
      actionable: z
        .boolean()
        .describe(
          "true if butler can reduce effort here, false if it's just notes/journaling",
        ),
    }),
  ),
});

export type ScratchpadIntent = z.infer<typeof ScratchpadIntentSchema>;

// ── Prompt ─────────────────────────────────────────────────────────────

function buildDecisionPrompt(
  previousParagraphs: string[],
  currentParagraphs: string[],
  connectedIntegrations: string[],
): string {
  const prevSection = previousParagraphs.length > 0
    ? previousParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")
    : "(empty)";

  return `You are a decision layer for a personal butler. The user has a daily scratchpad — a personal notepad where they jot down thoughts, tasks, notes, and ideas throughout the day. Most of what they write is for themselves, not for the butler.

Your job: compare the previous state to the current state, identify what's new or changed, and decide if any of it is something the butler should **proactively act on without asking**.

IMPORTANT: The scratchpad is NOT a command interface. The user is writing notes for themselves. The butler should only intervene when the text contains a clear, unambiguous action that the butler can complete on its own — without needing to ask the user what they mean or what they want.

<butler_capabilities>
The butler has access to: ${connectedIntegrations.length > 0 ? connectedIntegrations.join(", ") : "email, calendar"}
The butler can also: search the web, search user's memory, send messages, manage tasks/reminders
</butler_capabilities>

<previous_state>
${prevSection}
</previous_state>

<current_state>
${currentParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</current_state>

Compare the two states. Focus ONLY on paragraphs that are new or modified.

For each new/changed paragraph, ask: **"Does this text contain a clear action the butler can execute RIGHT NOW without asking any follow-up questions?"**

If the answer is no — skip it. The user is just taking notes.

**Actionable** (butler knows exactly what to do):
- "check my emails for anything urgent" → butler can search emails now
- "remind me to call mom at 6pm" → butler can set a reminder now
- "what's on my calendar tomorrow" → butler can look it up now
- "draft a reply to Sarah's email about the proposal" → butler can draft it now
- "find competitor pricing for Notion" → butler can research now

**NOT actionable** (skip — user is writing notes for themselves):
- "meetings tomorrow" — is this a note? a question? a todo? unclear → skip
- "email Sarah" — too vague, about what? → skip
- "important emails" — a note/category header, not a request → skip
- "feeling good about progress" — personal reflection → skip
- "API uses REST not GraphQL" — technical note → skip
- "sent the invoice" — recording what happened → skip
- "ideas for the new feature" — brainstorming header → skip
- Any text where you'd need to ask "what do you mean?" or "what do you want me to do?" → skip

Rules:
- Default is NOT actionable. Most scratchpad text is personal notes. Only mark actionable when the intent is crystal clear.
- NEVER mark something actionable if the butler would need to ask a clarifying question to proceed.
- The "intent" field must be a clear instruction the butler can execute. Transform user text into a butler action. Example: "important emails from today" → "Find and summarize today's important emails"
- paragraphIndices: 1-based indices from <current_state>
- Multiple related paragraphs can form ONE intent
- ONLY include new or modified paragraphs
- If nothing is clearly actionable, return an empty intents array — this is the expected common case`;
}

// ── Decision call ──────────────────────────────────────────────────────

export async function classifyScratchpadIntents(
  previousParagraphs: string[],
  currentParagraphs: string[],
  connectedIntegrations: string[],
  workspaceId: string,
): Promise<ScratchpadIntent> {
  const prompt = buildDecisionPrompt(previousParagraphs, currentParagraphs, connectedIntegrations);

  const { object } = await makeStructuredModelCall(
    ScratchpadIntentSchema,
    [{ role: "user", content: prompt }],
    "medium",
    "scratchpad-decision",
    0.3,
    workspaceId,
    "chat",
  );

  return object;
}
