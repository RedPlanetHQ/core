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
  /** Always returned — explains what the butler found and why it acted or stayed quiet */
  decision: z
    .string()
    .describe(
      "One or two sentences summarising what was new/changed and what the butler decided to do with it. Returned even when intents is empty.",
    ),
  intents: z.array(
    z.object({
      /** 1-based indices into the <current_state> list */
      paragraphIndices: z
        .array(z.number())
        .describe("1-based indices from <current_state> that this intent comes from"),
      /**
       * Actionable: clear execution instruction ("Set a reminder for 6 pm call with mom").
       * Commentable: short opening question/offer ("You mentioned emailing Manoj about the Saturday event — want me to draft it?").
       */
      intent: z
        .string()
        .describe(
          "Actionable: instruction for the butler to execute. Commentable: opening question or offer the butler will send back to the user.",
        ),
      /** true = butler engages (executes or asks). false = pure notes, butler stays quiet. */
      actionable: z
        .boolean()
        .describe(
          "true for Delegation, Task, Question, Event/Reminder, Follow-up, and Plan categories. false for Reference, Reflection, and Idea categories.",
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

  return `You are a decision layer for a personal butler. The user has a daily scratchpad where they jot down anything throughout the day — tasks, notes, ideas, plans, questions. Most of it is for themselves. Your job is to identify what's new or changed and decide whether the butler should engage.

<butler_capabilities>
The butler has access to: ${connectedIntegrations.length > 0 ? connectedIntegrations.join(", ") : "email, calendar"}
The butler can also: search the web, search user's memory, send messages, manage tasks and reminders
</butler_capabilities>

<previous_state>
${prevSection}
</previous_state>

<current_state>
${currentParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</current_state>

Compare the two states. Focus ONLY on paragraphs that are new or modified.

---

## Step 1 — Classify each new/changed paragraph into one of these categories:

**ENGAGE categories** (actionable: true — butler acts or asks):

| Category | Description | Examples |
|---|---|---|
| Delegation | User is directly instructing the butler | "@alfred send my standup", "can you check my emails" |
| Task / TODO | Something the user needs to get done | "need to fix the login bug", "submit the invoice today", "review John's PR" |
| Question / Research | User wants to find something out | "what's Notion's pricing?", "who leads growth at Acme?", "check if there's an update on X" |
| Event / Reminder | Time-bound thing to remember or schedule | "call mom at 6pm", "standup in 10 min", "flight on Friday at 8am" |
| Follow-up | User has an open loop with someone or something | "I have to send an email to Manoj about the Saturday event", "need to follow up with the investor", "check back with Sarah on the proposal" |
| Plan / Intention | User intends to do something or wants to structure their day | "today I want to finish auth", "going to focus on the backend this week", "I need to take action on the recent meeting" |

**SKIP categories** (actionable: false — butler stays quiet):

| Category | Description | Examples |
|---|---|---|
| Reference / Note | User storing information for themselves | "API uses REST not GraphQL", "John's number is 9999", "meeting was at 10am" |
| Reflection | Personal feeling or observation | "feeling good about progress", "that went better than expected", "holy shit that was tough" |
| Idea | Brainstorm or hypothetical, not a commitment | "idea: what if we added dark mode", "might be interesting to explore Y" |
| Record | Something that already happened | "sent the invoice", "pushed the fix", "cancelled the meeting" |

---

## Step 2 — For each ENGAGE paragraph, set actionable: true and write the intent:

- **Delegation, Task, Question, Event/Reminder**: butler can act now → write a clear execution instruction.
  - "remind me to call mom at 6pm" → intent: "Set a reminder for 6pm to call mom"
  - "check my emails for anything urgent" → intent: "Search emails and summarise anything urgent from today"
  - "find competitor pricing for Notion" → intent: "Research and summarise Notion's current pricing tiers"

- **Follow-up, Plan**: butler needs one clarification → write a short opening question or offer.
  - "I have to send an email to Manoj about the Saturday event" → intent: "You mentioned emailing Manoj about the Saturday event — want me to draft it? Any details I should include?"
  - "I need to take action on the recent meeting, notes are in Granola" → intent: "Looks like you have action items from a recent meeting — what should I pick up first?"
  - "going to focus on the backend this week" → intent: "Want me to pull your open backend tasks so you can prioritise?"
  - "need to follow up with the investor by EOD" → intent: "Which investor, and what's the follow-up about? I can draft the message once I know."

## Step 3 — For each SKIP paragraph, do not include it in intents at all.

---

Rules:
- paragraphIndices: 1-based indices from <current_state>
- Multiple related paragraphs can form ONE intent
- ONLY include new or modified paragraphs
- Always return the decision field explaining what you found and what you decided, even if intents is empty
- If nothing warrants engagement, return an empty intents array with a decision explaining why`;
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
