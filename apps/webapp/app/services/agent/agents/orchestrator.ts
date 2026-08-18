/**
 * Orchestrator Agent Factory
 *
 * Creates a Mastra Agent that handles integration actions, memory search,
 * and web search. Gateway tools are now direct tools on the core agent.
 *
 * In write mode, execute_integration_action has requireApproval on risky
 * write actions (send, delete, create, post).
 */

import { createTool } from "@mastra/core/tools";
import PQueue from "p-queue";
import { z } from "zod";

import { runWebExplorer, searchCoreDocs } from "../explorers";
import { logger } from "~/services/logger.service";
import { type ModelConfig } from "~/services/llm-provider.server";
import { type SkillRef } from "../types";
import { type OrchestratorTools, DirectOrchestratorTools } from "../executors";
import { getProgressUpdateTool } from "../tools/utils-tools";
import { truncateToolResult } from "../tools/truncate-result";

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
// Factory
// ---------------------------------------------------------------------------

export interface BuildOrchestratorToolsResult {
  tools: Record<string, any>;
  integrationsList: string;
}

/**
 * Build the orchestrator's tool set as a flat map, ready to fold into the
 * main agent's tools. Previously this returned two Mastra Agents (read +
 * write) that the main agent delegated to; that split is gone — the main
 * agent now owns every tool directly and there's no gather_context /
 * take_action indirection.
 *
 * The old `mode` split gated `acknowledge` (write) and `web_search` (read);
 * both are now unconditional (`acknowledge` was later removed entirely in
 * favor of `progress_update`).
 * `execute_integration_action` still uses `requireApproval` when
 * `interactive` is true so the user can review risky writes; scheduled and
 * background contexts pass `interactive=false` and skip the gate.
 */
export async function buildOrchestratorTools(
  userId: string,
  workspaceId: string,
  timezone: string,
  source: string,
  userPersona?: string,
  skills?: SkillRef[],
  executorTools?: OrchestratorTools,
  interactive: boolean = true,
  _modelConfig?: ModelConfig,
): Promise<BuildOrchestratorToolsResult> {
  const executor = executorTools ?? new DirectOrchestratorTools();

  // Per-turn cap on parallel integration actions. A single morning-brief turn
  // was firing ~10 read_email calls at once, each pinning a full Gmail body
  // in heap until the truncation step ran. Concurrency 3 keeps a 4x ceiling
  // on simultaneous raw payloads.
  const integrationActionQueue = new PQueue({ concurrency: 3 });

  const connectedIntegrations = await executor.getIntegrations(
    userId,
    workspaceId,
  );

  const integrationsList = connectedIntegrations
    .map(
      (int, index) =>
        `${index + 1}. **${int.integrationDefinition.name}** — accountId: ${int.id} (pass this UUID to get_integration_actions/execute_integration_action; user identifier for reference: ${int.accountId})`,
    )
    .join("\n");

  // Hint appended to "account not found" errors so the LLM can pattern-match
  // a typo against a known-good ID and retry, instead of giving up.
  const validAccountIdsHint =
    connectedIntegrations.length > 0
      ? `Valid accountIds for this user:\n` +
        connectedIntegrations
          .map(
            (int) =>
              `- ${int.id} — ${int.integrationDefinition.name} (${int.accountId})`,
          )
          .join("\n")
      : "No connected integrations for this user.";

  const enrichAccountNotFound = (errorMessage: string): string => {
    if (/not found or not active|Integration account .* not found/i.test(errorMessage)) {
      return `${errorMessage}\n\n${validAccountIdsHint}\n\nRetry with one of the accountIds above.`;
    }
    return errorMessage;
  };

  logger.info(
    `Orchestrator tools: loaded ${connectedIntegrations.length} integrations`,
  );

  // Build Mastra tools
  const tools: Record<string, any> = {};

  // progress_update — global narration for long-running fetches/writes
  tools.progress_update = getProgressUpdateTool();

  // memory_search — available in both modes
  tools.memory_search = createTool({
    id: "memory_search",
    description:
      "Search the user's memory for prior context, preferences, and directives not covered by the persona. Describe your intent in full sentences, not keywords.",
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

  // contact_search — compact profile lookup for a known person
  tools.contact_search = createTool({
    id: "contact_search",
    description:
      "Look up a known person in the user's People/contacts and return their compact profile (identity, relationship to the user, recent context, contact details). Use this FIRST for questions about a specific person. For an exhaustive deep dive across raw memory, use memory_search instead.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The person's name, or a short description of who to find"),
    }),
    execute: async (inputData) => {
      logger.info(`Orchestrator: contact search - ${inputData.query}`);
      return executor.searchContacts(inputData.query, userId, workspaceId);
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
          "The UUID from the accountId field in CONNECTED INTEGRATIONS (e.g. 'a1b2c3d4-...'). Do NOT pass the integration slug ('github', 'gmail', 'slack') — pass the UUID.",
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
          workspaceId,
        );
        // Unwrap MCP response format { content: [{ text }], isError }
        if (
          result &&
          typeof result === "object" &&
          "content" in (result as any)
        ) {
          const isError = (result as any).isError === true;
          const content = (result as any).content;
          if (Array.isArray(content) && content.length > 0 && content[0].text) {
            const text = content[0].text as string;
            return isError ? enrichAccountNotFound(text) : text;
          }
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.warn(
          `Failed to get actions for ${inputData.accountId}: ${errorMessage}`,
        );
        return `ERROR: ${enrichAccountNotFound(errorMessage)}`;
      }
    },
  });

  // execute_integration_action — requireApproval on risky writes in write mode
  tools.execute_integration_action = createTool({
    id: "execute_integration_action",
    description:
      "Execute an action on a connected integration. Use the inputSchema from get_integration_actions to know what parameters to pass. If this fails, check the error and retry with corrected parameters.",
    inputSchema: z.object({
      accountId: z
        .string()
        .describe(
          "The UUID from the accountId field in CONNECTED INTEGRATIONS. Do NOT pass the integration slug ('github', 'gmail', 'slack') — pass the UUID.",
        ),
      action: z.string().describe("Action name from get_integration_actions"),
      parameters: z
        .string()
        .describe(
          "Action parameters as JSON string, matching the inputSchema exactly",
        ),
    }),
    // Only require approval for risky write actions in interactive mode.
    // Non-interactive callers (scheduled fires, background workers) skip the
    // gate — they run under trusted context and can't surface prompts anyway.
    requireApproval: interactive,
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
        const truncated = await integrationActionQueue.add(async () => {
          const result = await executor.executeIntegrationAction(
            inputData.accountId,
            inputData.action,
            parsedParams,
            userId,
            source,
          );
          // Truncate inside the queue slot so the raw response is released
          // before the next slot starts — this is the whole point of the cap.
          return truncateToolResult(result, {
            label: "execute_integration_action",
            pretty: false,
          });
        });
        return truncated;
      } catch (error: any) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.warn(
          `Integration action failed: ${inputData.accountId}/${inputData.action}`,
          error,
        );
        return `ERROR: ${enrichAccountNotFound(errorMessage)}. Check the inputSchema and retry with corrected parameters.`;
      }
    },
  });

  // `acknowledge` removed — `progress_update` handles the same "on it"
  // narration across interactive and background contexts.

  // web_search — real-time lookups when memory + integrations don't cover it
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
      logger.info(`Orchestrator tools: web search - ${inputData.query}`);
      const result = await runWebExplorer(inputData.query, timezone, workspaceId);
      return result.success ? result.data : "web search unavailable";
    },
  });

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

  logger.info(
    `Orchestrator tools: built ${Object.keys(tools).length} tools`,
  );

  return { tools, integrationsList };
}
