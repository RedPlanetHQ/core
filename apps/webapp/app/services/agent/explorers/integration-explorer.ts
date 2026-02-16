import {
  streamText,
  type LanguageModel,
  stepCountIs,
  tool,
  StreamTextResult,
} from "ai";
import { z } from "zod";

import { logger } from "~/services/logger.service";
import { getModel, getModelForTask } from "~/lib/model.server";
import {
  handleExecuteIntegrationAction,
  handleGetIntegrationActions,
} from "~/utils/mcp/integration-operations";

export interface Integration {
  slug: string;
  name: string;
  accountId: string;
}

export type IntegrationMode = "read" | "write";
const INTEGRATION_COMPLEXITY = "high";

/**
 * Get date in user's timezone formatted as YYYY-MM-DD
 */
function getDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA gives YYYY-MM-DD format
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

const getIntegrationExplorerPrompt = (
  integrations: string,
  mode: IntegrationMode = "read",
  timezone: string = "UTC",
) => {
  const modeInstructions =
    mode === "write"
      ? `You can CREATE, UPDATE, or DELETE. Execute the requested action.`
      : `READ ONLY. Never create, update, or delete.`;

  // Get current date and time in user's timezone
  const now = new Date();
  const today = getDateInTimezone(now, timezone);
  const currentDateTime = getDateTimeInTimezone(now, timezone);

  // Calculate yesterday in user's timezone
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = getDateInTimezone(yesterday, timezone);

  return `You are an Integration Explorer. ${mode === "write" ? "Execute actions on" : "Query"} ONE specific integration.

NOW: ${currentDateTime} (${timezone})
TODAY: ${today}
YESTERDAY: ${yesterdayDate}

⚠️ DATE/TIME QUERIES: Be cautious with datetime filters - each integration has different date formats and query syntax. Check the inputSchema carefully. Relative terms like "newer_than:1d" can be unreliable. Prefer explicit date ranges when available.

CONNECTED INTEGRATIONS:
${integrations || "No integrations connected."}

TOOLS:
- get_integration_actions: Find available actions for a service (returns inputSchema)
- execute_integration_action: Execute an action with parameters matching inputSchema

EXECUTION:
1. Identify which ONE integration matches the request
2. Get actions for that integration (this gives you the inputSchema)
3. Execute the action with parameters matching the schema exactly
4. If you need more detail (e.g., full email body), call get_integration_actions again with a new query to find the right action, then execute it
5. Return the result

MULTI-STEP WORKFLOWS:
- Search/list actions return metadata only (id, title, subject). Use the ID to fetch full content.
- After search: call get_integration_actions with "get by id" or "read" query, then execute with the ID.
- Fetch full content when user asks what something says, contains, or asks for.

Query: "what does the email from John say"                                                                                                                                         
→ search emails from John → get id → fetch email by id → return body                                                                                                               
                                                                                                                                                                                   
Query: "summarize the PR for auth fix"                                                                                                                                             
→ search PRs for auth → get PR number → fetch PR details → return description/diff                                                                                                 
                                                                                                                                                                                   
Query: "what's in the Linear issue about onboarding"                                                                                                                               
→ search issues for onboarding → get issue id → fetch issue details → return full description                                                                                      
                                                                                                                                                                                   
Fetch full content when user asks what something says, contains, or asks for.

PARAMETER FORMATTING:
- Follow the inputSchema exactly - use the field names, types, and formats it specifies
- ISO 8601 timestamps MUST include timezone: 2025-01-01T00:00:00Z (not 2025-01-01T00:00:00)
- Use the exact field names from inputSchema
- Check required vs optional fields
- Match the data types exactly as specified in the schema
- Provide values in the exact format expected by the schema
- Do not invent field names or data types not present in the schema

BE PROACTIVE:
If a specific query returns empty, explore before reporting:
1. Validate the resource exists with a broader query
2. If a filter caused empty results, show what filter options actually exist
3. Give user enough context to refine their request without asking

RULES:
- ${modeInstructions}
- Facts only. No personality.
- Target exactly ONE integration per request.
- If the integration isn't connected, say so.

⚠️ USER CONFIRMATION REQUIRED FOR DESTRUCTIVE ACTIONS:
Before executing any CREATE, UPDATE, or DELETE action, you MUST:
1. STOP and ask the user for confirmation
2. Clearly explain what you're about to do with ALL the details:
   - For CREATE: Show the exact data you'll create (title, description, fields, etc.)
   - For UPDATE: Show what will change (old value → new value)
   - For DELETE: Show exactly what will be deleted (name, ID, etc.)
3. Wait for explicit user approval before calling execute_integration_action
4. Only proceed if the user confirms

Examples:
- "I'm about to create a GitHub issue:\n  **Title:** Fix auth timeout\n  **Body:** The authentication is timing out after 30s...\n  **Repo:** core\n  Shall I proceed?"
- "I'm about to delete the calendar event 'Team Standup' on Feb 16 at 10am. Are you sure?"
- "I'm about to send this Slack message to #general:\n  'Deployment complete! 🚀'\n  Confirm?"

NEVER execute destructive actions without user confirmation.

CRITICAL - FINAL SUMMARY:
When you have completed the integration query/action, write a clear, concise summary as your final response.
This summary will be returned to the orchestrator, so include all relevant details from the results.`;
};

export interface IntegrationExplorerResult {
  stream: any;
  startTime: number;
  hasIntegrations: boolean;
}

export async function runIntegrationExplorer(
  query: string,
  integrations: string,
  mode: IntegrationMode = "read",
  timezone: string = "UTC",
  source: string,
  userId: string,
  abortSignal?: AbortSignal,
): Promise<IntegrationExplorerResult> {
  const startTime = Date.now();

  // Use provided integrations or fetch them
  const availableIntegrations = integrations;

  if (!availableIntegrations.length) {
    // Return empty stream for no integrations
    const stream = streamText({
      model: getModel() as LanguageModel,
      messages: [{ role: "user", content: "no integrations connected" }],
      abortSignal,
    });

    return {
      stream,
      startTime,
      hasIntegrations: false,
    };
  }

  const tools = {
    get_integration_actions: tool({
      description:
        "Get available actions for a specific integration. Returns action name, description, and input schema.",
      inputSchema: z.object({
        accountId: z
          .string()
          .describe(
            "Integration account ID from the connected integrations list",
          ),
        query: z.string().describe("What you want to do"),
      }),
      execute: async ({ accountId, query }) => {
        try {
          const actions = await handleGetIntegrationActions({
            accountId,
            query,
          });
          // Return full action details including schema
          return JSON.stringify(actions, null, 2);
        } catch (error) {
          logger.warn(`Failed to get actions for ${accountId}: ${error}`);
          return "[]";
        }
      },
    }),

    execute_integration_action: tool({
      description:
        "Execute an action on an integration. Use the inputSchema from get_integration_actions to know what parameters to pass. If this fails, check the error and retry with corrected parameters.",
      inputSchema: z.object({
        accountId: z.string().describe("Integration account ID"),
        action: z.string(),
        parameters: z
          .string()
          .describe("Action parameters as JSON string based on inputSchema"),
      }),

      execute: async ({ accountId, action, parameters }) => {
        try {
          const parsedParams = JSON.parse(parameters);
          logger.info(
            `IntegrationExplorer: Executing ${accountId}/${action} with params: ${JSON.stringify(parsedParams)}`,
          );
          const result = await handleExecuteIntegrationAction({
            accountId,
            action,
            parameters: parsedParams,
            source,
            userId,
          });
          return JSON.stringify(result);
        } catch (error: any) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `Integration action failed: ${accountId}/${action}`,
            error,
          );
          // Return error details so LLM can retry with corrected parameters
          return `ERROR: ${errorMessage}. Check the inputSchema and retry with corrected parameters.`;
        }
      },
    }),
  };

  const model = getModelForTask(INTEGRATION_COMPLEXITY);
  logger.info(
    `IntegrationExplorer: Starting stream, complexity: ${INTEGRATION_COMPLEXITY}, model: ${model}`,
  );

  const modelInstance = getModel(model);

  const stream = streamText({
    model: modelInstance as LanguageModel,
    system: getIntegrationExplorerPrompt(availableIntegrations, mode, timezone),
    messages: [{ role: "user", content: query }],
    tools,
    stopWhen: stepCountIs(10),
    abortSignal,
  });

  return {
    stream,
    startTime,
    hasIntegrations: true,
  };
}
