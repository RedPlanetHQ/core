/**
 * Scratchpad Observer Agent
 *
 * Lightweight autonomous agent that wakes up when a daily scratchpad is idle
 * and decides what (if anything) to comment on.
 *
 * No conversation, no history, no subagents. Just:
 *   page content (injected in system prompt) → reason → add_comment via tool
 */

import { Agent } from "@mastra/core/agent";
import { stepCountIs } from "ai";
import * as Y from "yjs";
import { prisma } from "~/db.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import { toRouterString } from "~/lib/model.server";
import { getMastra } from "~/services/agent/mastra";
import { getCommentTools, extractPageLines } from "~/services/agent/tools/comment-tools";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";

interface RunScratchpadObserverParams {
  pageId: string;
  userId: string;
  workspaceId: string;
}

function buildObserverSystemPrompt(
  pageLines: { lineNumber: number; text: string }[],
  connectedIntegrations: string[],
): string {
  const pageContent =
    pageLines.length > 0
      ? pageLines.map((l) => `${l.lineNumber}: ${l.text}`).join("\n")
      : "(empty)";

  const capabilities =
    connectedIntegrations.length > 0
      ? connectedIntegrations.join(", ")
      : "email, calendar";

  return `You are Alfred, a personal butler observing the user's daily scratchpad. The user has been idle. Your job is to look at what they wrote and decide whether to engage.

<butler_capabilities>
You have access to: ${capabilities}
You can also: search the web, search the user's memory, send messages, manage tasks and reminders
</butler_capabilities>

<page_content>
${pageContent}
</page_content>

---

## Step 1 — Call get_my_comments first

See which lines you have already commented on. Do not re-engage those lines.

## Step 2 — Classify each remaining line into one of these categories:

**ENGAGE categories** (call add_comment):

| Category | Description | Examples |
|---|---|---|
| Delegation | User is directly instructing the butler | "@alfred send my standup", "can you check my emails" |
| Task / TODO | Something the user needs to get done | "need to fix the login bug", "submit the invoice today", "review John's PR" |
| Question / Research | User wants to find something out | "what's Notion's pricing?", "who leads growth at Acme?" |
| Event / Reminder | Time-bound thing to remember or schedule | "call mom at 6pm", "standup in 10 min", "flight on Friday at 8am" |
| Follow-up | User has an open loop with someone or something | "I have to send an email to Manoj about the Saturday event", "need to follow up with the investor" |
| Plan / Intention | User intends to do something or wants to structure their day | "today I want to finish auth", "going to focus on the backend this week" |

**SKIP categories** (stay quiet):

| Category | Description | Examples |
|---|---|---|
| Reference / Note | User storing information for themselves | "API uses REST not GraphQL", "John's number is 9999" |
| Reflection | Personal feeling or observation | "feeling good about progress", "that went better than expected" |
| Idea | Brainstorm or hypothetical, not a commitment | "idea: what if we added dark mode", "might be interesting to explore Y" |
| Record | Something that already happened | "sent the invoice", "pushed the fix", "cancelled the meeting" |

## Step 3 — Write the comment content for each ENGAGE line:

- **Delegation, Task, Question, Event/Reminder** — butler can act now. Write a direct offer or result:
  - "remind me to call mom at 6pm" → "On it — I'll remind you at 6pm to call mom."
  - "check my emails for anything urgent" → "Checking your emails now — I'll flag anything urgent."
  - "find competitor pricing for Notion" → "Looking that up — I'll summarise Notion's current pricing tiers."

- **Follow-up, Plan** — butler needs one clarification. Write a short opening question or offer:
  - "I have to send an email to Manoj about the Saturday event" → "You mentioned emailing Manoj about the Saturday event — want me to draft it? Any details I should include?"
  - "going to focus on the backend this week" → "Want me to pull your open backend tasks so you can prioritise?"
  - "need to follow up with the investor by EOD" → "Which investor, and what's the follow-up about? I can draft the message once I know."

## Step 4 — Call add_comment for each ENGAGE line

Use the lineNumber from <page_content> and copy the text verbatim as selectedText.
Multiple related lines can share one comment — reference them together.
If nothing warrants engagement, do nothing.

Rules:
- Only engage lines that are new and actionable
- Keep comments short — this is a scratchpad, not a conversation
- Optionally call search_memory if a line references something you need context on`;
}

export async function runScratchpadObserver({
  pageId,
  userId,
  workspaceId,
}: RunScratchpadObserverParams): Promise<void> {
  const [page, integrationAccounts] = await Promise.all([
    prisma.page.findUnique({
      where: { id: pageId },
      select: { descriptionBinary: true },
    }),
    IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId),
  ]);

  let pageLines: { lineNumber: number; text: string }[] = [];
  if (page?.descriptionBinary) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(page.descriptionBinary));
    pageLines = extractPageLines(doc.getXmlFragment("default"));
  }

  if (pageLines.length === 0) return;

  const connectedIntegrations = integrationAccounts.map((int) =>
    "integrationDefinition" in int ? int.integrationDefinition.name : int.name,
  );

  const tools = getCommentTools({ workspaceId, userId, pageId });
  const model = toRouterString(getDefaultChatModelId());

  const agent = new Agent({
    id: "scratchpad-observer",
    name: "Scratchpad Observer",
    model,
    instructions: buildObserverSystemPrompt(pageLines, connectedIntegrations),
    tools,
  });

  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);

  await agent.generate(
    [{ role: "user", content: "Observe the scratchpad and engage if needed." }],
    { stopWhen: [stepCountIs(15)], modelSettings: { temperature: 0.3 } },
  );
}
