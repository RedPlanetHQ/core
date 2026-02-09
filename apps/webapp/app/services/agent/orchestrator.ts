import {
  streamText,
  type LanguageModel,
  stepCountIs,
  tool,
  readUIMessageStream,
} from "ai";
import { z } from "zod";

import {
  runIntegrationExplorer,
  runMemoryExplorer,
  runWebExplorer,
} from "./explorers";
import { logger } from "../logger.service";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { getModel, getModelForTask } from "~/lib/model.server";

export type OrchestratorMode = "read" | "write";

const getOrchestratorPrompt = (
  integrations: string,
  mode: OrchestratorMode,
) => {
  if (mode === "write") {
    return `You are an orchestrator. Execute actions on integrations.

CONNECTED INTEGRATIONS:
${integrations}

TOOLS:
- integration_action: Execute an action on a connected service (create, update, delete)

EXAMPLES:

Action: "send a slack message to #general saying standup in 5"
Execute: integration_action({ integration: "slack", action: "send message to #general: standup in 5" })

Action: "create a github issue for auth bug in core repo"
Execute: integration_action({ integration: "github", action: "create issue titled auth bug in core repo" })

Action: "add a page to notion called Meeting Notes"
Execute: integration_action({ integration: "notion", action: "create page titled Meeting Notes" })

Action: "block 2pm tomorrow on calendar for deep work"
Execute: integration_action({ integration: "google-calendar", action: "create event tomorrow 2pm titled deep work" })

RULES:
- Execute the action. No personality.
- Return result of action (success/failure and details).
- If integration not connected, say so.

CRITICAL - FINAL SUMMARY:
When you have completed the action, write a clear, concise summary as your final response.
This summary will be returned to the parent agent, so include:
- What action was performed
- The result (success/failure)
- Any relevant details (IDs, URLs, error messages)

Example final summary: "Created GitHub issue #123 'Fix auth bug' in core repo. URL: https://github.com/org/core/issues/123"`;
  }

  return `You are an orchestrator. Gather information based on the intent.

CONNECTED INTEGRATIONS:
${integrations}

TOOLS:
- memory_search: Past conversations, stored knowledge, decisions, preferences. CORE handles query understanding internally.
- integration_query: Live data from connected services (emails, calendar, issues, messages)
- web_search: Real-time information from the web (news, current events, documentation, prices, weather, general knowledge). Also use to read/summarize URLs shared by user.

YOUR JOB:
Read the intent carefully. Decide WHERE the information lives:
- Memory: past interactions, stored context, history, user preferences
- Integrations: live/current data from external services (user's emails, calendar, issues)
- Web: real-time info not in memory or integrations (news, weather, docs, how-tos, current events, general questions)
- Multiple: when you need info from several sources

CRITICAL FOR memory_search:
- Describe your INTENT - what you need from memory and why.
- Write it like asking a colleague to find something.
- CORE has agentic search that understands natural language.

BAD (keyword soup - will fail):
- "rerank evaluation metrics NDCG MRR pairwise pointwise"
- "Manoj Sol rerank evaluation dataset methodology"

GOOD (clear intent):
- "Find past discussions about rerank evaluation - what approach was decided, any metrics discussed, next steps"
- "What has user said about their morning routine preferences and productivity habits"
- "Previous conversations about the deployment plan and any blockers mentioned"

EXAMPLES:

Intent: "What did we discuss about the marketing strategy"
→ memory_search("Find past discussions about marketing strategy - decisions made, timeline, who's involved")

Intent: "Show me my upcoming meetings this week"
→ integration_query: google-calendar (live data)

Intent: "Status of the deployment - what we planned vs current blockers"
→ memory_search("Previous discussions about deployment planning and decisions") + integration_query: github/linear

Intent: "What's the weather in San Francisco"
→ web_search (real-time data, not in memory or integrations)

Intent: "Latest news about AI regulation"
→ web_search (current events)

Intent: "What's the tech news" / "what's happening in AI"
→ web_search (world/industry news - NOT user's personal inbox)

Intent: "How do I use React Server Components"
→ web_search (documentation, how-tos)

Intent: "What's the current price of Bitcoin"
→ web_search (real-time market data)

Intent: "What newsletters came in today" / "my GitHub notifications"
→ integration_query: gmail (user's personal inbox - NOT web search)

Intent: "summarize this: https://example.com/article"
→ web_search (reads the URL content)

Intent: "what does this link say? https://blog.com/post"
→ web_search (fetches and summarizes the URL)

BE PROACTIVE:
- If a specific query returns empty, try a broader one to validate data exists.
- If memory returns nothing on a specific topic, try related topics before reporting empty.
- If integration returns empty, confirm the resource exists (repo, channel, calendar) before saying "nothing found".

RULES:
- For memory_search: describe what you need, not keywords.
- Call multiple tools in parallel when data could be in multiple places.
- When in doubt, include memory_search.
- No personality. Return raw facts.`;
};

export interface OrchestratorResult {
  stream: ReturnType<typeof streamText>;
  startTime: number;
}

export async function runOrchestrator(
  userId: string,
  workspaceId: string,
  userMessage: string,
  mode: OrchestratorMode = "read",
  timezone: string = "UTC",
  source: string,
  abortSignal?: AbortSignal,
): Promise<OrchestratorResult> {
  const startTime = Date.now();

  // Get user's connected integrations
  const connectedIntegrations =
    await IntegrationLoader.getConnectedIntegrationAccounts(
      userId,
      workspaceId,
    );

  const integrationsList = connectedIntegrations
    .map(
      (int, index) =>
        `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id}) (Identifier: ${int.accountId})`,
    )
    .join("\n");

  logger.info(
    `Orchestrator: Loaded ${connectedIntegrations.length} integrations, mode: ${mode}`,
  );

  // Build tools based on mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  if (mode === "read") {
    tools.memory_search = tool({
      description:
        "Search past conversations, user preferences, stored knowledge. CORE handles query understanding internally.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for - describe your intent clearly"),
      }),
      execute: async function* ({ query }, { abortSignal }) {
        logger.info(`Orchestrator: memory search - ${query}`);

        const { stream } = await runMemoryExplorer(
          query,
          userId,
          workspaceId,
          source,
          abortSignal,
        );

        // Stream the memory explorer's work
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
        }
      },
    });

    tools.integration_query = tool({
      description: "Query a connected integration for current data",
      inputSchema: z.object({
        integration: z
          .string()
          .describe(
            "Which integration to query (e.g., github, slack, notion, google-calendar, gmail)",
          ),
        query: z.string().describe("What data to get"),
      }),
      execute: async function* ({ integration, query }, { abortSignal }) {
        logger.info(
          `Orchestrator: integration query - ${integration}: ${query}`,
        );

        const { stream, hasIntegrations } = await runIntegrationExplorer(
          `${query} from ${integration}`,
          integrationsList,
          "read",
          timezone,
          source,
          abortSignal,
        );

        if (!hasIntegrations) {
          yield {
            parts: [{ type: "text", text: "No integrations connected" }],
          };
          return;
        }

        // Stream the integration explorer's work
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
        }
      },
    });

    tools.web_search = tool({
      description:
        "Search the web for real-time information: news, current events, documentation, prices, weather, general knowledge. Use when info is not in memory or integrations.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for - be specific and clear"),
      }),
      execute: async ({ query }) => {
        logger.info(`Orchestrator: web search - ${query}`);
        const result = await runWebExplorer(query, timezone);
        return result.success ? result.data : "web search unavailable";
      },
    });
  } else {
    // Write mode - action tool
    tools.integration_action = tool({
      description:
        "Execute an action on a connected integration (create, send, update, delete)",
      inputSchema: z.object({
        integration: z
          .string()
          .describe(
            "Which integration to use (e.g., github, slack, notion, google-calendar, gmail)",
          ),
        action: z.string().describe("What action to perform, be specific"),
      }),
      execute: async function* ({ integration, action }, { abortSignal }) {
        logger.info(
          `Orchestrator: integration action - ${integration}: ${action}`,
        );

        const { stream, hasIntegrations } = await runIntegrationExplorer(
          `${action} on ${integration}`,
          integrationsList,
          "write",
          timezone,
          source,
          abortSignal,
        );

        if (!hasIntegrations) {
          yield {
            parts: [{ type: "text", text: "No integrations connected" }],
          };
          return;
        }

        // Stream the integration explorer's work
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          yield message;
        }
      },
    });
  }

  const model = getModelForTask("high");
  const modelInstance = getModel(model);

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: getOrchestratorPrompt(integrationsList, mode),
    messages: [{ role: "user", content: userMessage }],
    tools,
    stopWhen: stepCountIs(10),
    abortSignal,
  });

  logger.info(`Orchestrator: Starting stream for mode ${mode}`);

  return {
    stream,
    startTime,
  };
}
