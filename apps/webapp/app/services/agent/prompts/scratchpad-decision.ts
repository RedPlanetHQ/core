/**
 * Scratchpad Decision Prompt
 *
 * Lightweight LLM call that classifies proactive page edits into intents.
 * Runs BEFORE creating conversations — filters noise and splits multi-intent diffs.
 *
 * Input:  diff paragraphs (new/modified text) + full page context + connected integrations
 * Output: list of actionable intents with paragraph indices mapping back to diff
 */

import { z } from "zod";
import { makeStructuredModelCall } from "~/lib/model.server";

// ── Schema ─────────────────────────────────────────────────────────────

export const ScratchpadIntentSchema = z.object({
  intents: z.array(
    z.object({
      /** 1-based indices into the new_or_modified_content list */
      paragraphIndices: z
        .array(z.number())
        .describe("1-based indices from the <new_or_modified_content> list that this intent comes from"),
      /** What the user wants done — phrased as a clear instruction for the agent */
      intent: z
        .string()
        .describe("Clear instruction for the butler describing what needs to be done"),
      /** Whether this is actionable (butler can/should act on it) */
      actionable: z
        .boolean()
        .describe("true if butler can reduce effort here, false if it's just notes/journaling"),
    }),
  ),
});

export type ScratchpadIntent = z.infer<typeof ScratchpadIntentSchema>;

// ── Prompt ─────────────────────────────────────────────────────────────

function buildDecisionPrompt(
  diffParagraphs: string[],
  fullPageParagraphs: string[],
  connectedIntegrations: string[],
): string {
  return `You are a decision layer for a personal butler. The user has a daily scratchpad where they jot down thoughts, tasks, and notes throughout the day. Your job: look at what they just wrote and decide where the butler can proactively help — reduce their effort, save them time, or surface useful information.

<butler_capabilities>
The butler can:
- Read, search, and act on connected tools: ${connectedIntegrations.length > 0 ? connectedIntegrations.join(", ") : "email, calendar (default)"}
- Search the web and read URLs
- Search the user's memory (past conversations, context, preferences)
- Send messages (email, Slack, WhatsApp)
- Create/update/manage tasks and reminders
- Run browser automation and coding tasks via gateway agents

The butler cannot: process audio, video, or PDF files
</butler_capabilities>

<full_page_context>
${fullPageParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</full_page_context>

<new_or_modified_content>
${diffParagraphs.map((p, i) => `${i + 1}. ${p}`).join("\n")}
</new_or_modified_content>

Analyze ONLY the new/modified content. The full page is for context only.

Ask yourself for each piece of new content: **"Can the butler reduce effort here?"**

**Actionable** — butler can help:
- Mentions a connected tool → butler can look it up ("important emails today", "any PR reviews pending", "what's on calendar")
- Implies a lookup or research → butler can find it ("competitor pricing", "flight status", "weather tomorrow")
- A task or follow-up → butler can track or do it ("follow up with design team", "check if PR was merged")
- A request → butler can act ("draft reply to Sarah", "schedule meeting with team")
- A reminder → butler can set it ("remind me to call mom at 6pm")
- A question → butler can answer it ("what time is standup?", "when does the lease expire?")
- Short phrases about things butler has access to → fetch and surface ("team standup notes", "slack thread about migration")

**Not actionable** — just notes, skip:
- Personal reflections or journaling ("feeling good about progress", "tough day")
- Technical notes the user is recording ("API uses REST not GraphQL", "decided to use Postgres")
- Recording what already happened, past tense ("sent the invoice", "merged the PR", "had lunch with team")
- Pasted content — URLs, code snippets, reference material being stored
- Incomplete fragments — single words or partial sentences mid-typing
- Lists that are purely for reference with no implied action ("meeting attendees: Alice, Bob, Carol")

Rules:
- When in doubt, mark it actionable — better to help than to miss
- The "intent" field must be a clear instruction for the butler, not a quote of what the user wrote. Transform what they wrote into what the butler should do. Example: "important emails from today" → "Find and summarize today's important emails"
- Use paragraphIndices to reference which numbered items from <new_or_modified_content> this intent comes from (1-based)
- Multiple related paragraphs can form ONE intent with multiple indices
- If nothing is actionable, return an empty intents array`;
}

// ── Decision call ──────────────────────────────────────────────────────

export async function classifyScratchpadIntents(
  diffParagraphs: string[],
  fullPageParagraphs: string[],
  connectedIntegrations: string[],
  workspaceId: string,
): Promise<ScratchpadIntent> {
  const prompt = buildDecisionPrompt(diffParagraphs, fullPageParagraphs, connectedIntegrations);

  const { object } = await makeStructuredModelCall(
    ScratchpadIntentSchema,
    [{ role: "user", content: prompt }],
    "low",
    "scratchpad-decision",
    0.3,
    workspaceId,
    "chat",
  );

  return object;
}
