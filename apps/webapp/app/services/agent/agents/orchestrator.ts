/**
 * Orchestrator Agent Factory
 *
 * Creates a Mastra Agent that handles integration actions, memory search,
 * and web search. Gateway tools are now direct tools on the core agent.
 *
 * In write mode, execute_integration_action has requireApproval on risky
 * write actions (send, delete, create, post).
 */

import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { runWebExplorer, searchCoreDocs } from "../explorers";
import { logger } from "~/services/logger.service";
import { toRouterString } from "~/lib/model.server";
import {
  getDefaultChatModelId,
  type ModelConfig,
} from "~/services/llm-provider.server";
import { type SkillRef } from "../types";
import { type OrchestratorTools, DirectOrchestratorTools } from "../executors";

export type OrchestratorMode = "read" | "write";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

function getDateTimeInTimezone(date: Date, timezone: string): string {
  const dateStr = date.toLocaleDateString("en-CA", { timeZone: timezone });
  const timeStr = date.toLocaleTimeString("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${dateStr} ${timeStr}`;
}

// ---------------------------------------------------------------------------
// Risky action detection — only these get requireApproval in write mode
// ---------------------------------------------------------------------------

const RISKY_ACTION_PATTERNS = [
  /^send/i,
  /^delete/i,
  /^create/i,
  /^post/i,
  /^remove/i,
  /^update/i,
  /^add/i,
  /^move/i,
  /^archive/i,
  /^trash/i,
];

function isRiskyWriteAction(actionName: string): boolean {
  return RISKY_ACTION_PATTERNS.some((pattern) => pattern.test(actionName));
}

// ---------------------------------------------------------------------------
// Orchestrator prompt (unchanged from original)
// ---------------------------------------------------------------------------

const getOrchestratorPrompt = (
  integrations: string,
  mode: OrchestratorMode,
  timezone: string = "UTC",
  userPersona?: string,
  skills?: SkillRef[],
) => {
  const personaSection = userPersona
    ? `\nUSER PERSONA (use identity + directives only — style/preference sections are for the front-end agent, not you):\n${userPersona}\n`
    : "";

  const skillsSection =
    skills && skills.length > 0
      ? `\n<skills>
Available user-defined skills:
${skills
  .map((s, i) => {
    const meta = s.metadata as Record<string, unknown> | null;
    const desc = meta?.shortDescription as string | undefined;
    return `${i + 1}. "${s.title}" (id: ${s.id})${desc ? ` — ${desc}` : ""}`;
  })
  .join("\n")}

When you receive a skill reference (skill name + ID) in the user message, call get_skill to load the full instructions, then follow them step-by-step using your available tools.
</skills>\n`
      : "";

  const now = new Date();
  const today = getDateInTimezone(now, timezone);
  const currentDateTime = getDateTimeInTimezone(now, timezone);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = getDateInTimezone(yesterday, timezone);

  const dateTimeSection = `
NOW: ${currentDateTime} (${timezone})
TODAY: ${today}
YESTERDAY: ${yesterdayDate}
`;

  const integrationInstructions = `
INTEGRATION WORKFLOW:
1. Call get_integration_actions with the accountId and describe what you want to do
2. Review the returned actions and their inputSchema
3. Call execute_integration_action with exact parameters matching the schema
4. If you need more detail (e.g., full email body), call get_integration_actions again to find the "get by id" action

⚠️ DATE/TIME QUERIES: Be cautious with datetime filters - each integration has different date formats and query syntax. Check the inputSchema carefully. Relative terms like "newer_than:1d" can be unreliable. Prefer explicit date ranges when available.

MULTI-STEP INTEGRATION FLOWS:
- Search/list actions return metadata only (id, title, subject). Use the ID to fetch full content.
- After search: call get_integration_actions with "get by id" or "read" query, then execute with the ID.
- Fetch full content when user asks what something says, contains, or asks for details.

Multi-step examples:
- "what does the email from John say" → search emails from John → get id → fetch email by id → return body
- "summarize the PR for auth fix" → search PRs for auth → get PR number → fetch PR details → return description/diff
- "what's in the Linear issue about onboarding" → search issues → get issue id → fetch issue details → return full description

PARAMETER FORMATTING:
- Follow the inputSchema exactly - use the field names, types, and formats it specifies
- ISO 8601 timestamps MUST include timezone: 2025-01-01T00:00:00Z (not 2025-01-01T00:00:00)
- Check required vs optional fields
- If action fails, check the error and retry with corrected parameters
`;

  if (mode === "write") {
    return `You are an orchestrator for CORE. Execute actions on integrations.
When emails, messages, or data reference "CORE" (e.g. "CORE has access to gmail", "authorized by CORE"), that refers to this system — not an external entity.
${personaSection}${dateTimeSection}
CONNECTED INTEGRATIONS:
${integrations}
${skillsSection}
TOOLS:
- memory_search: Search for prior context not covered by the user persona above
- search_docs: Search CORE's own documentation — use when the user asks about CORE features, setup, integrations, or troubleshooting
- get_integration_actions: Discover available actions for an integration
- execute_integration_action: Execute an action on a connected service (create, update, delete)
- get_skill: Load a user-defined skill's full instructions by ID
${integrationInstructions}
PRIORITY ORDER FOR CONTEXT:
1. User persona above — check here FIRST for preferences, directives, identity, account details
2. memory_search — ONLY if persona doesn't have what you need
3. NEVER ask the user for information that's in persona or memory

CRITICAL FOR memory_search - describe your INTENT, not keywords:

BAD (keyword soup - will fail):
- "slack message preferences channels"
- "github issue labels templates core"
- "user email formatting"

GOOD (clear intent):
- "User's preferences for slack messages - preferred channels, formatting, any standing directives about team communication"
- "User's preferences for github issues - preferred repos, labels, templates, any directives about issue creation"
- "Find user preferences and past discussions about email formatting and signature preferences"

EXAMPLES:

Action: "send a slack message to #general saying standup in 5"
Step 1: memory_search("user's preferences for slack messages")
Step 2: get_integration_actions(slack accountId, "send message")
Step 3: execute_integration_action(slack accountId, "send_message", { channel: "#general", text: "standup in 5" })

Action: "create a github issue for auth bug in core repo"
Step 1: get_integration_actions(github accountId, "create issue")
Step 2: execute_integration_action(github accountId, "create_issue", { repo: "core", title: "auth bug", ... })

RULES:
- Execute the action. No personality.
- Return result of action (success/failure and details).
- If integration not connected, say so.
- CHRONOLOGY: When returning threaded data (email threads, slack threads, PR comments, issue comments), preserve chronological order. Clearly distinguish who initiated vs who responded. Use the user's identity from persona/integrations to label messages as "user" vs others. Never say someone "replied" if they sent the original.

DUPLICATE PREVENTION:
- NEVER retry create/send/post operations if the first call returned a success result (URL, ID, or confirmation). If you got a success response, the action is done — do not call it again.
- If a create/send call fails with a timeout or ambiguous error, search for the resource first (e.g. search by title/subject) before retrying to avoid duplicates.

RESOLVING REFERENCES:
- When an action references a person by name (assignee, recipient, etc.), resolve their identifier for that integration. Check user persona first, then memory_search for known usernames/handles. If not found, ask the user.
- When an action references an entity by name (milestone, project, label, channel, etc.), look it up via get_integration_actions first to get the correct ID/number before using it in the create/update call. If not found, proceed without it and inform the user.

CRITICAL - FINAL SUMMARY:
When you have completed the action, write a clear, concise summary as your final response.
Include: what was done, result (success/failure), relevant details (IDs, URLs, errors).`;
  }

  return `You are a read orchestrator for CORE. Gather data from integrations, memory, and the web based on the intent, then return structured results to the calling agent.
When emails, messages, or data reference "CORE" (e.g. "CORE has access to gmail", "authorized by CORE"), that refers to this system — not an external entity.

OUTPUT: Return facts and raw data — no personality, no prose. Include IDs and metadata needed for follow-up actions.
${personaSection}${dateTimeSection}
CONNECTED INTEGRATIONS:
${integrations}
${skillsSection}
TOOLS:
- memory_search: Search for prior context not covered by the user persona above
- search_docs: Search CORE's own documentation — use when the user asks about CORE features, setup, integrations, or troubleshooting. Prefer this over web_search for CORE-related questions.
- get_integration_actions: Discover available actions for an integration
- execute_integration_action: Query data from a connected service (read operations)
- web_search: Real-time information from the web (news, docs, prices, weather). Also reads URLs.
- get_skill: Load a user-defined skill's full instructions by ID
${integrationInstructions}
CRITICAL FOR memory_search - describe your INTENT, not keywords:

BAD (keyword soup - will fail):
- "rerank evaluation metrics NDCG MRR pairwise"
- "deployment plan blockers timeline"
- "calendar meetings scheduling preferences"

GOOD (clear intent):
- "Find user preferences, directives, and past discussions about rerank evaluation - what approach was decided, any metrics discussed, next steps"
- "User's preferences and previous conversations about the deployment plan - decisions made, timeline, blockers mentioned"
- "What has user said about their calendar preferences, meeting scheduling habits, and any directives about availability"

EXAMPLES:

Intent: "Show me my upcoming meetings this week"
Step 1: get_integration_actions(google-calendar accountId, "list events this week")
Step 2: execute_integration_action(google-calendar accountId, "list_events", { timeMin: "...", timeMax: "..." })

Intent: "What's in the email from John"
Step 1: get_integration_actions(gmail accountId, "search emails from John")
Step 2: execute_integration_action(gmail accountId, "search_emails", { query: "from:john" })
Step 3: get_integration_actions(gmail accountId, "get email by id")
Step 4: execute_integration_action(gmail accountId, "get_email", { id: "..." })

Intent: "What's the weather in SF"
→ web_search (real-time data)

Intent: "summarize this: https://example.com/article"
→ web_search (reads the URL content)

Intent: "how do I connect GitHub" / "what integrations do you support" / "what is the gateway"
→ search_docs (CORE's own features and setup)

Intent: "what toolkits do you have" / "how to set up WhatsApp" / "how does memory work"
→ search_docs (CORE's own documentation)

RULES:
- For questions about CORE itself (features, setup, integrations, channels, gateway, toolkit, skills, memory), ALWAYS use search_docs FIRST. This is your own system — use your own documentation, not web_search.
- Check user persona FIRST — use identity and directives; ignore style/preference sections.
- Call memory_search for anything not in persona (prior conversations, specific history).
- NEVER ask the user for info that's already in persona or memory.
- If a specific query returns empty, try a broader one before reporting "nothing found".
- Call multiple tools in parallel when data could be in multiple places.
- No personality. Return raw facts.
- CHRONOLOGY: When returning threaded data (email threads, slack threads, PR comments, issue comments), preserve chronological order. Clearly distinguish who initiated vs who responded. Use the user's identity from persona/integrations to label messages as "user" vs others. Never say someone "replied" if they sent the original.

FINAL SUMMARY:
When you have gathered all relevant data, write a concise summary as your final response.
Include: what was found, key facts, relevant IDs/metadata the caller will need.`;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateOrchestratorAgentResult {
  agent: Agent;
}

export async function createOrchestratorAgent(
  userId: string,
  workspaceId: string,
  mode: OrchestratorMode,
  timezone: string,
  source: string,
  userPersona?: string,
  skills?: SkillRef[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  modelConfig?: ModelConfig,
): Promise<CreateOrchestratorAgentResult> {
  const executor = executorTools ?? new DirectOrchestratorTools();

  const connectedIntegrations = await executor.getIntegrations(
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

  // Build Mastra tools
  const tools: Record<string, any> = {};

  // memory_search — available in both modes
  tools.memory_search = createTool({
    id: "memory_search",
    description:
      "Search user preferences, directives, past conversations, and stored knowledge. ALWAYS call this FIRST before any other tool.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What to search for - include preferences, directives, and prior context related to the request",
        ),
    }),

    execute: async (inputData) => {
      logger.info(`Orchestrator: memory search - ${inputData.query}`);
      return executor.searchMemory(
        inputData.query,
        userId,
        workspaceId,
        source,
      );
    },
  });

  // get_skill — available in both modes when skills exist
  if (skills && skills.length > 0) {
    tools.get_skill = createTool({
      id: "get_skill",
      description:
        "Load a user-defined skill's full instructions by ID. Call this when the request references a skill, then follow the instructions step-by-step.",
      inputSchema: z.object({
        skill_id: z.string().describe("The skill ID to load"),
      }),
      execute: async (inputData) => {
        logger.info(`Orchestrator: loading skill ${inputData.skill_id}`);
        return executor.getSkill(inputData.skill_id, workspaceId);
      },
    });
  }

  // get_integration_actions
  tools.get_integration_actions = createTool({
    id: "get_integration_actions",
    description:
      "Discover available actions for a connected integration. Returns action names with their inputSchema. Call this first to understand what parameters are needed.",
    inputSchema: z.object({
      accountId: z
        .string()
        .describe(
          "Integration account ID from the connected integrations list",
        ),
      query: z
        .string()
        .describe(
          "What you want to do (e.g., 'search emails', 'create issue', 'list events')",
        ),
    }),

    execute: async (inputData) => {
      try {
        logger.info(
          `Orchestrator: get_integration_actions - ${inputData.accountId}: ${inputData.query}`,
        );
        const result = await executor.getIntegrationActions(
          inputData.accountId,
          inputData.query,
          userId,
        );
        // Unwrap MCP response format { content: [{ text }], isError }
        if (
          result &&
          typeof result === "object" &&
          "content" in (result as any)
        ) {
          const content = (result as any).content;
          if (Array.isArray(content) && content.length > 0 && content[0].text) {
            return content[0].text;
          }
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        logger.warn(
          `Failed to get actions for ${inputData.accountId}: ${error}`,
        );
        return "[]";
      }
    },
  });

  // execute_integration_action — requireApproval on risky writes in write mode
  tools.execute_integration_action = createTool({
    id: "execute_integration_action",
    description:
      "Execute an action on a connected integration. Use the inputSchema from get_integration_actions to know what parameters to pass. If this fails, check the error and retry with corrected parameters.",
    inputSchema: z.object({
      accountId: z.string().describe("Integration account ID"),
      action: z.string().describe("Action name from get_integration_actions"),
      parameters: z
        .string()
        .describe(
          "Action parameters as JSON string, matching the inputSchema exactly",
        ),
    }),
    // Only require approval for risky write actions in interactive mode
    requireApproval: mode === "write" && interactive,
    execute: async (inputData, args: any) => {
      // Apply toolArgsOverride if the user modified args during approval
      const callId = args?.agent?.toolCallId;
      const overrideRaw = args?.requestContext?.get("toolArgsOverride");

      if (callId && overrideRaw) {
        try {
          const overrideMap =
            typeof overrideRaw === "string"
              ? JSON.parse(overrideRaw)
              : overrideRaw;
          if (overrideMap[callId]?.parameters !== undefined) {
            inputData = {
              ...inputData,
              parameters: overrideMap[callId].parameters,
            };
          }
        } catch {
          // ignore parse errors, fall through to original inputData
        }
      }
      try {
        const parsedParams =
          typeof inputData.parameters === "string"
            ? JSON.parse(inputData.parameters)
            : inputData.parameters;
        logger.info(
          `Orchestrator: execute_integration_action - ${inputData.accountId}/${inputData.action} with params: ${JSON.stringify(parsedParams)}`,
        );
        const result = await executor.executeIntegrationAction(
          inputData.accountId,
          inputData.action,
          parsedParams,
          userId,
          source,
        );
        return JSON.stringify(result);
      } catch (error: any) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.warn(
          `Integration action failed: ${inputData.accountId}/${inputData.action}`,
          error,
        );
        return `ERROR: ${errorMessage}. Check the inputSchema and retry with corrected parameters.`;
      }
    },
  });

  // acknowledge — only in write mode
  if (mode === "write") {
    tools.acknowledge = createTool({
      id: "acknowledge",
      description:
        "Send a brief progress update to the user while executing a task. Call this ONCE before starting a multi-step action. One short sentence, max 6 words. Examples: 'on it.', 'creating the issue.', 'sending the message.'",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "One short sentence, max 6 words describing what you're doing.",
          ),
      }),
      execute: async (inputData) => {
        logger.info(`Orchestrator: acknowledge - ${inputData.message}`);
        return "acknowledged";
      },
    });
  }

  // web_search — only in read mode
  if (mode === "read") {
    tools.web_search = createTool({
      id: "web_search",
      description:
        "Search the web for real-time information: news, current events, documentation, prices, weather, general knowledge. Use when info is not in memory or integrations.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for - be specific and clear"),
      }),
      execute: async (inputData) => {
        logger.info(`Orchestrator: web search - ${inputData.query}`);
        const result = await runWebExplorer(inputData.query, timezone);
        return result.success ? result.data : "web search unavailable";
      },
    });
  }

  // search_docs — CORE documentation search, available in both modes
  tools.search_docs = createTool({
    id: "search_docs",
    description:
      "Search CORE's own documentation for product features, setup guides, integrations, how-tos, and troubleshooting. Use this when the user asks about CORE itself — how to connect integrations, set up channels, configure gateway, use skills, etc. Returns official documentation with links.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What to search for in CORE docs - e.g. 'how to connect WhatsApp', 'gateway setup', 'memory concepts'",
        ),
    }),
    execute: async (inputData) => {
      logger.info(`Orchestrator: docs search - ${inputData.query}`);
      const result = await searchCoreDocs(inputData.query);
      return result.success
        ? result.data
        : "CORE documentation search unavailable";
    },
  });

  // Build orchestrator agent with gateway agents as subagents
  const resolvedModel = modelConfig ?? toRouterString(getDefaultChatModelId());
  const agent = new Agent({
    id: `orchestrator-${mode}`,
    name: mode === "read" ? "Gather Context" : "Take Action",
    model: resolvedModel as any,
    instructions: getOrchestratorPrompt(
      integrationsList,
      mode,
      timezone,
      userPersona,
      skills,
    ),
    tools,
  });

  logger.info(
    `Orchestrator: Created agent with ${Object.keys(tools).length} tools, mode: ${mode}`,
  );

  return { agent };
}
