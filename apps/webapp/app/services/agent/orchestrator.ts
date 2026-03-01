import {
  streamText,
  type LanguageModel,
  stepCountIs,
  tool,
  readUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { runWebExplorer } from "./explorers";
import { runGatewayExplorer } from "./gateway";
import { logger } from "../logger.service";
import { getModel, getModelForTask } from "~/lib/model.server";
import { type SkillRef } from "./types";
import { OrchestratorTools, DirectOrchestratorTools } from "./orchestrator-tools";

/**
 * Recursively checks if a message contains any tool part with state "approval-requested"
 */
const hasApprovalRequested = (message: UIMessage): boolean => {
  const checkParts = (parts: any[]): boolean => {
    for (const part of parts) {
      if (part.state === "approval-requested") {
        return true;
      }
      // Check nested output.parts (sub-agent responses)
      if (part.output?.parts && Array.isArray(part.output.parts)) {
        if (checkParts(part.output.parts)) return true;
      }
      // Check nested output.content
      if (part.output?.content && Array.isArray(part.output.content)) {
        if (checkParts(part.output.content)) return true;
      }
    }
    return false;
  };

  return message.parts ? checkParts(message.parts) : false;
};

export type OrchestratorMode = "read" | "write";

/**
 * Get date in user's timezone formatted as YYYY-MM-DD
 */
function getDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * Get datetime in user's timezone formatted as YYYY-MM-DD HH:MM:SS
 */
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

const getOrchestratorPrompt = (
  integrations: string,
  mode: OrchestratorMode,
  gateways: string,
  timezone: string = "UTC",
  userPersona?: string,
  skills?: SkillRef[],
) => {
  const personaSection = userPersona
    ? `\nUSER PERSONA (identity, preferences, directives - use this FIRST before searching memory):\n${userPersona}\n`
    : "";

  const skillsSection =
    skills && skills.length > 0
      ? `\n<skills>
Available user-defined skills:
${skills.map((s, i) => {
        const meta = s.metadata as Record<string, unknown> | null;
        const desc = meta?.shortDescription as string | undefined;
        return `${i + 1}. "${s.title}" (id: ${s.id})${desc ? ` — ${desc}` : ""}`;
      }).join("\n")}

When you receive a skill reference (skill name + ID) in the user message, call get_skill to load the full instructions, then follow them step-by-step using your available tools.
</skills>\n`
      : "";

  // Get current date and time in user's timezone
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
    return `You are an orchestrator. Execute actions on integrations or gateways.
${personaSection}${dateTimeSection}
CONNECTED INTEGRATIONS:
${integrations}

<gateways>
${gateways || "No gateways connected"}
</gateways>
${skillsSection}
TOOLS:
- memory_search: Search for prior context not covered by the user persona above
- get_integration_actions: Discover available actions for an integration
- execute_integration_action: Execute an action on a connected service (create, update, delete)
- get_skill: Load a user-defined skill's full instructions by ID
- gateway_*: Offload tasks to connected gateways based on their description
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

Action: "fix the auth bug in core repo" (gateway task)
Execute: gateway_harshith_mac({ intent: "fix the auth bug in core repo" })

RULES:
- Execute the action. No personality.
- Return result of action (success/failure and details).
- If integration/gateway not connected, say so.
- Match tasks to gateways based on their descriptions.

CRITICAL - FINAL SUMMARY:
When you have completed the action, write a clear, concise summary as your final response.
Include: what was done, result (success/failure), relevant details (IDs, URLs, errors).`;
  }

  return `You are an orchestrator. Gather information based on the intent.
${personaSection}${dateTimeSection}
CONNECTED INTEGRATIONS:
${integrations}

<gateways>
${gateways || "No gateways connected"}
</gateways>
${skillsSection}
TOOLS:
- memory_search: Search for prior context not covered by the user persona above
- get_integration_actions: Discover available actions for an integration
- execute_integration_action: Query data from a connected service (read operations)
- web_search: Real-time information from the web (news, docs, prices, weather). Also reads URLs.
- get_skill: Load a user-defined skill's full instructions by ID
- gateway_*: Offload tasks to connected gateways based on their description
${integrationInstructions}
PRIORITY ORDER FOR CONTEXT:
1. User persona above — check here FIRST for preferences, directives, identity
2. memory_search — if persona doesn't have what you need
3. Integrations / web_search — for live data or real-time info
4. NEVER ask the user for information that's in persona or memory

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

BE PROACTIVE:
- If a specific query returns empty, try a broader one to validate data exists.
- If integration returns empty, confirm the resource exists before saying "nothing found".

RULES:
- Check user persona FIRST — it has identity, preferences, directives.
- Call memory_search for anything not in persona (prior conversations, specific history).
- NEVER ask the user for info that's already in persona or memory.
- Call multiple tools in parallel when data could be in multiple places.
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
  userPersona?: string,
  skills?: SkillRef[],
  executorTools?: OrchestratorTools,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const executor = executorTools ?? new DirectOrchestratorTools();

  // Get user's connected integrations
  const connectedIntegrations = await executor.getIntegrations(userId, workspaceId);

  const integrationsList = connectedIntegrations
    .map(
      (int, index) =>
        `${index + 1}. **${int.integrationDefinition.name}** (Account ID: ${int.id}) (Identifier: ${int.accountId})`,
    )
    .join("\n");

  // Get connected gateways
  const gateways = await executor.getGateways(workspaceId);
  const gatewaysList = gateways
    .map(
      (gw, index) =>
        `${index + 1}. **${gw.name}** (tool: gateway_${gw.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}): ${gw.description}`,
    )
    .join("\n");

  logger.info(
    `Orchestrator: Loaded ${connectedIntegrations.length} integrations, ${gateways.length} gateways, mode: ${mode}`,
  );

  // Build tools based on mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  // memory_search is available in both read and write modes
  tools.memory_search = tool({
    description:
      "Search user preferences, directives, past conversations, and stored knowledge. ALWAYS call this FIRST before any other tool.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What to search for - include preferences, directives, and prior context related to the request",
        ),
    }),
    execute: async ({ query }) => {
      logger.info(`Orchestrator: memory search - ${query}`);
      return executor.searchMemory(query, userId, workspaceId, source);
    },
  });

  // get_skill tool - available in both modes when skills exist
  if (skills && skills.length > 0) {
    tools.get_skill = tool({
      description:
        "Load a user-defined skill's full instructions by ID. Call this when the request references a skill, then follow the instructions step-by-step.",
      inputSchema: z.object({
        skill_id: z
          .string()
          .describe("The skill ID to load"),
      }),
      execute: async ({ skill_id }) => {
        logger.info(`Orchestrator: loading skill ${skill_id}`);
        return executor.getSkill(skill_id, workspaceId);
      },
    });
  }

  // Integration tools - available in both modes
  tools.get_integration_actions = tool({
    description:
      "Discover available actions for a connected integration. Returns action names with their inputSchema. Call this first to understand what parameters are needed.",
    inputSchema: z.object({
      accountId: z
        .string()
        .describe("Integration account ID from the connected integrations list"),
      query: z
        .string()
        .describe("What you want to do (e.g., 'search emails', 'create issue', 'list events')"),
    }),
    execute: async ({ accountId, query }) => {
      try {
        logger.info(`Orchestrator: get_integration_actions - ${accountId}: ${query}`);
        const actions = await executor.getIntegrationActions(accountId, query, userId);
        return JSON.stringify(actions, null, 2);
      } catch (error) {
        logger.warn(`Failed to get actions for ${accountId}: ${error}`);
        return "[]";
      }
    },
  });

  tools.execute_integration_action = tool({
    description:
      "Execute an action on a connected integration. Use the inputSchema from get_integration_actions to know what parameters to pass. If this fails, check the error and retry with corrected parameters.",
    inputSchema: z.object({
      accountId: z.string().describe("Integration account ID"),
      action: z.string().describe("Action name from get_integration_actions"),
      parameters: z
        .string()
        .describe("Action parameters as JSON string, matching the inputSchema exactly"),
    }),
    execute: async ({ accountId, action, parameters }) => {
      try {
        const parsedParams = JSON.parse(parameters);
        logger.info(
          `Orchestrator: execute_integration_action - ${accountId}/${action} with params: ${JSON.stringify(parsedParams)}`,
        );
        const result = await executor.executeIntegrationAction(
          accountId,
          action,
          parsedParams,
          userId,
          source,
        );
        return JSON.stringify(result);
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Integration action failed: ${accountId}/${action}`, error);
        return `ERROR: ${errorMessage}. Check the inputSchema and retry with corrected parameters.`;
      }
    },
  });

  // Web search - only in read mode
  if (mode === "read") {
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
  }

  // Add gateway tools for both modes
  for (const gateway of gateways) {
    if (gateway.status !== "CONNECTED") continue;

    const toolName = `gateway_${gateway.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    tools[toolName] = tool({
      description: `**${gateway.name}** - ${gateway.description}`,
      inputSchema: z.object({
        intent: z
          .string()
          .describe(
            "Describe what you want to accomplish. Be specific about the task.",
          ),
      }),
      execute: async function* ({ intent }, { abortSignal }) {
        logger.info(`Orchestrator: Gateway ${gateway.name} - ${intent}`);

        const { stream, gatewayConnected } = await runGatewayExplorer(
          gateway.id,
          intent,
          abortSignal,
          executor,
        );

        if (!gatewayConnected || !stream) {
          yield {
            parts: [
              {
                type: "text",
                text: `Gateway "${gateway.name}" is not connected.`,
              },
            ],
          };
          return;
        }

        let approvalRequested = false;
        for await (const message of readUIMessageStream({
          stream: stream.toUIMessageStream(),
        })) {
          if (approvalRequested) {
            continue;
          }

          yield message;

          if (hasApprovalRequested(message)) {
            logger.info(
              `Orchestrator: Stopping gateway ${gateway.name} - approval requested`,
            );
            approvalRequested = true;
          }
        }
      },
    });
  }

  const model = getModelForTask("high");
  const modelInstance = getModel(model);

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: getOrchestratorPrompt(
      integrationsList,
      mode,
      gatewaysList,
      timezone,
      userPersona,
      skills,
    ),
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
