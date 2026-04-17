/**
 * @deprecated Scratchpad Observer Agent — no longer in use.
 *
 * Lightweight autonomous agent that wakes up when a daily scratchpad is idle
 * and decides what (if anything) to comment on.
 *
 * No conversation, no history, no subagents. Just:
 *   annotated page XML (injected in system prompt) → reason → add_comment via tool
 */

import { Agent } from "@mastra/core/agent";
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import * as Y from "yjs";
import { prisma } from "~/db.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import { toRouterString } from "~/lib/model.server";
import { getMastra } from "~/services/agent/mastra";
import { getCommentTools, buildAnnotatedPageXml } from "~/services/agent/tools/comment-tools";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { runWebExplorer } from "~/services/agent/explorers/web-explorer";

interface RunScratchpadObserverParams {
  pageId: string;
  userId: string;
  workspaceId: string;
}

function buildObserverSystemPrompt(
  pageXml: string,
  connectedIntegrations: string[],
  scratchpadReadSkill: string,
): string {
  const capabilities =
    connectedIntegrations.length > 0
      ? connectedIntegrations.join(", ")
      : "email, calendar";

  return `You are the butler's decision layer for the daily scratchpad. The user has been idle. Your job is to observe what they wrote, decide what's actionable, and dispatch work to the main agent.

<butler_capabilities>
The main agent has access to: ${capabilities}
The main agent can also: search the web, search the user's memory, send messages, manage tasks and reminders, create scheduled tasks, draft emails
</butler_capabilities>

<user_preferences>
${scratchpadReadSkill}
</user_preferences>

<page_content>
${pageXml}
</page_content>

---

## Step 1 — Read the XML, respect markers, apply grouping rule

The page content is structured XML. Each element represents a block in the document.

**Grouping rule:** When a \`<paragraph>\` or \`<heading>\` is immediately followed by a \`<bulletList>\`, \`<orderedList>\`, or \`<taskList>\`, treat them as one section. Comment once on the paragraph/heading using its exact text as \`selectedText\`. Do not comment on individual list items. If the paragraph has \`data-commented="true"\`, skip the entire section including its list.

**Already commented:** Any node with \`data-commented="true"\` already has an active comment — skip it entirely.

## Step 2 — Call search_memory for ENGAGE items

Before classifying, search memory for context on any item that mentions a person, project, meeting, or commitment. For Exploratory items, also call search_web for reference material.

Examples:
- "follow up with investor" → search_memory("investor meetings and follow-ups")
- "create a Show HN post" → search_memory("product positioning and messaging") + search_web("Show HN best practices")

## Step 3 — Classify each remaining section

**ENGAGE categories** (call add_comment):

| Category | Description | Examples |
|---|---|---|
| Delegation | User is directly instructing the butler | "@alfred send my standup", "can you check my emails" |
| Task / TODO | Something the user needs to get done with a clear outcome | "submit the invoice today", "fix the login bug" |
| Question / Research | User wants to find something out | "what's Notion's pricing?", "who leads growth at Acme?" |
| Event / Reminder | Time-bound thing to remember or schedule | "call mom at 6pm", "standup in 10 min" |
| Follow-up | User has an open loop with someone or something | "email Manoj about Saturday event", "follow up with investor" |
| Plan / Intention | User intends to do something or wants to structure their day | "today I want to finish auth", "focus on backend this week" |
| Exploratory | Open-ended creative or research task, outcome is vague | "create a Show HN post", "think about our pricing", "help me prep for the board meeting" |

**SKIP categories** (stay quiet):

| Category | Description | Examples |
|---|---|---|
| Reference / Note | User storing information for themselves | "API uses REST not GraphQL", "John's number is 9999" |
| Reflection | Personal feeling or observation | "feeling good about progress", "that went better than expected" |
| Idea | Brainstorm or hypothetical, not a commitment | "idea: what if we added dark mode" |
| Record | Something that already happened | "sent the invoice", "pushed the fix" |
| Task list items | Checkbox items the user manages themselves — skip individual bullets |

## Step 4 — Call add_comment per logical section

**selectedText**: copy the header paragraph/heading text verbatim from the XML. Do not use list item text.

**content**: What the user sees as the comment. Keep it short.

**intent**: A clear, complete instruction for the main agent. Self-contained — the main agent has no access to the scratchpad.

If add_comment returns a "not found" error, try a shorter phrase from the same block and retry once.

### Writing good intents by category:

**Delegation, Task, Question, Event/Reminder** — main agent executes immediately:
- content: "On it — setting a reminder for 6pm."
- intent: "Create a scheduled task to remind the user to call mom at 6pm today."

- content: "Checking your emails now."
- intent: "Search the user's email for anything urgent from today. Summarise findings."

**Follow-up, Plan** — main agent presents findings, does NOT execute yet:
- intent: "The user wants to email Manoj about the Saturday event. Context: [memory findings]. Do NOT send anything yet — ask the user to confirm details first."

**Exploratory** — do NOT write an execution intent. Instead:
1. Call search_memory for relevant context (product notes, past decisions)
2. Call search_web for reference material
3. Write add_comment where:
   - content: your gathered context + 2-3 initiating questions for the user
   - intent: "User wants to [X]. Context gathered: [findings]. This is exploratory — ask the following initiating questions before doing anything: [questions]. Wait for user response."

**Key rules:**
- Always include memory context in intent if found
- For follow-ups and exploratory: explicitly say "do NOT execute yet"
- The main agent has no access to the scratchpad — intent must be self-contained
- If nothing warrants engagement, do nothing — that's the expected common case`;
}

export async function runScratchpadObserver({
  pageId,
  userId,
  workspaceId,
}: RunScratchpadObserverParams): Promise<void> {
  const [page, integrationAccounts, existingComments, readingGuideSkill] = await Promise.all([
    prisma.page.findUnique({
      where: { id: pageId },
      select: { descriptionBinary: true },
    }),
    IntegrationLoader.getConnectedIntegrationAccounts(userId, workspaceId),
    prisma.butlerComment.findMany({
      where: { pageId, resolved: false },
      select: { relativeStart: true, selectedText: true },
    }),
    getDefaultSkill(workspaceId, "reading-guide"),
  ]);

  if (!page?.descriptionBinary) return;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(page.descriptionBinary));

  const pageXml = buildAnnotatedPageXml(doc, existingComments);
  if (!pageXml.trim()) return;

  const connectedIntegrations = integrationAccounts.map((int) =>
    "integrationDefinition" in int ? int.integrationDefinition.name : int.name,
  );

  const scratchpadReadSkill = readingGuideSkill?.content ?? "(No reading guide configured.)";

  const searchWebTool = tool({
    description:
      "Search the web for reference material when an exploratory task needs external context.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const result = await runWebExplorer(query);
      return result.success ? result.data : "Web search unavailable.";
    },
  });

  const tools = {
    ...getCommentTools({ workspaceId, userId, pageId }),
    search_web: searchWebTool,
  };

  const model = toRouterString(getDefaultChatModelId());

  const agent = new Agent({
    id: "scratchpad-observer",
    name: "Scratchpad Observer",
    model,
    instructions: buildObserverSystemPrompt(pageXml, connectedIntegrations, scratchpadReadSkill),
    tools,
  });

  const mastra = getMastra();
  (agent as any).__registerMastra(mastra);

  await agent.generate(
    [{ role: "user", content: "Observe the scratchpad and engage if needed." }],
    { stopWhen: [stepCountIs(15)], modelSettings: { temperature: 0.3 } },
  );
}
