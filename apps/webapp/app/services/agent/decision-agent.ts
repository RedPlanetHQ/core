/**
 * Decision Agent (CASE)
 *
 * Handles non-user triggers (reminders, webhooks, scheduled jobs) with intelligent reasoning.
 * Uses CASE framework to analyze context and produce action plans.
 *
 * Key differences from Sol:
 * - No personality, pure reasoning
 * - Uses fast/cheap model (Haiku)
 * - Outputs structured JSON action plans
 * - Does not interact with user directly
 * - Has gather_context tool to query orchestrator (read-only)
 */

import { generateText, stepCountIs } from "ai";
import { getModel, getModelForTask } from "~/lib/model.server";

import {
  type Trigger,
  type DecisionContext,
  type ActionPlan,
  type DecisionAgentResult,
} from "./types/decision-agent";
import { buildDecisionAgentPrompt } from "./prompts";
import { logger } from "../logger.service";
import { createTools } from "./core-agent";

/**
 * Default action plan when Decision Agent fails or produces invalid output
 */
const DEFAULT_ACTION_PLAN: ActionPlan = {
  shouldMessage: true,
  message: {
    intent: "Execute the triggered action",
    context: {},
    tone: "neutral",
  },
  createReminders: [],
  updateReminders: [],
  silentActions: [],
  reasoning: "Default plan - Decision Agent produced no valid output",
};

/**
 * Parse JSON from model response, handling common formatting issues
 */
function parseActionPlan(text: string): ActionPlan | null {
  try {
    // Try direct parse first
    const parsed = JSON.parse(text);
    if (isValidActionPlan(parsed)) {
      return parsed;
    }
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (isValidActionPlan(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to return null
      }
    }

    // Try finding JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (isValidActionPlan(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to return null
      }
    }
  }

  return null;
}

/**
 * Validate that parsed object has required ActionPlan fields
 */
function isValidActionPlan(obj: unknown): obj is ActionPlan {
  if (!obj || typeof obj !== "object") return false;

  const plan = obj as Record<string, unknown>;

  // Required field
  if (typeof plan.shouldMessage !== "boolean") return false;

  // If shouldMessage is true, message should exist
  if (plan.shouldMessage && !plan.message) return false;

  // Arrays should be arrays (or undefined/null)
  if (plan.createReminders && !Array.isArray(plan.createReminders))
    return false;
  if (plan.updateReminders && !Array.isArray(plan.updateReminders))
    return false;
  if (plan.silentActions && !Array.isArray(plan.silentActions)) return false;

  return true;
}

/**
 * Normalize action plan to ensure all optional fields have defaults
 */
function normalizeActionPlan(plan: ActionPlan): ActionPlan {
  return {
    shouldMessage: plan.shouldMessage,
    message: plan.message,
    createReminders: plan.createReminders || [],
    updateReminders: plan.updateReminders || [],
    silentActions: plan.silentActions || [],
    reasoning: plan.reasoning || "No reasoning provided",
  };
}

/**
 * Options for running the Decision Agent
 */
export interface DecisionAgentOptions {
  trigger: Trigger;
  context: DecisionContext;
  timezone?: string;
}

/**
 * Run the Decision Agent (CASE)
 *
 * Analyzes a trigger with context and produces an action plan.
 * Uses fast model (Haiku) for speed and cost efficiency.
 *
 * If mcpClient is provided, CASE can use the gather_context tool to query
 * memory, integrations, and web for additional information before deciding.
 *
 * @param trigger - The trigger that fired (reminder, webhook, etc.)
 * @param context - Rich context about user state, today's activity, history
 * @returns ActionPlan with decisions about messaging, follow-ups, and silent actions
 */
export async function runDecisionAgent(
  trigger: Trigger,
  context: DecisionContext,
  userPersona?: string,
): Promise<DecisionAgentResult> {
  const startTime = Date.now();

  try {
    // Format current time in user's timezone
    const timezone = context.user.timezone || "UTC";
    const currentTime = new Date().toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    // Build prompt with trigger and context as JSON
    const triggerJson = JSON.stringify(trigger, null, 2);
    const contextJson = JSON.stringify(
      {
        user: context.user,
        todayState: context.todayState,
        relevantHistory: context.relevantHistory,
        gatheredData: context.gatheredData,
      },
      null,
      2,
    );

    const prompt = buildDecisionAgentPrompt(
      triggerJson,
      contextJson,
      currentTime,
      timezone,
      userPersona,
    );

    logger.info("Running Decision Agent", {
      triggerType: trigger.type,
      userId: trigger.userId,
      channel: trigger.channel,
    });

    // Use low complexity model (auto-downgrades to Haiku)
    const model = getModelForTask("low");
    const modelInstance = getModel(model);

    // Build tools if MCP client is provided
    const tools = await createTools(
      context.user.userId,
      context.user.workspaceId,
      context.user.timezone,
      trigger.channel,
      true,
      userPersona,
    );

    const { text } = await generateText({
      model: modelInstance as any,
      messages: [{ role: "user", content: prompt }],
      tools,
      stopWhen: stepCountIs(5), // Allow multiple steps if tools available
    });

    // Parse the action plan from response
    const parsedPlan = parseActionPlan(text);

    if (!parsedPlan) {
      logger.warn(
        "Decision Agent produced invalid output, using default plan",
        {
          triggerType: trigger.type,
          responsePreview: text.substring(0, 200),
        },
      );

      // Create contextual default based on trigger type
      const fallbackPlan = createFallbackPlan(trigger);

      return {
        plan: fallbackPlan,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const normalizedPlan = normalizeActionPlan(parsedPlan);

    logger.info("Decision Agent completed", {
      triggerType: trigger.type,
      shouldMessage: normalizedPlan.shouldMessage,
      reasoning: normalizedPlan.reasoning,
      executionTimeMs: Date.now() - startTime,
    });

    return {
      plan: normalizedPlan,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error("Decision Agent failed", {
      triggerType: trigger.type,
      error,
    });

    // Return fallback plan on error
    const fallbackPlan = createFallbackPlan(trigger);

    return {
      plan: fallbackPlan,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Create a contextual fallback plan based on trigger type
 */
function createFallbackPlan(trigger: Trigger): ActionPlan {
  switch (trigger.type) {
    case "reminder_fired":
      return {
        shouldMessage: true,
        message: {
          intent: `Execute reminder: ${trigger.data.action}`,
          context: {
            action: trigger.data.action,
            reminderId: trigger.data.reminderId,
          },
          tone: "neutral",
        },
        createReminders: [],
        updateReminders: [],
        silentActions: [],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to message for reminder",
      };

    case "reminder_followup":
      return {
        shouldMessage: true,
        message: {
          intent: `Follow up on reminder: ${trigger.data.action}`,
          context: {
            action: trigger.data.action,
            reminderId: trigger.data.reminderId,
            isFollowUp: true,
          },
          tone: "casual",
        },
        createReminders: [],
        updateReminders: [],
        silentActions: [],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to follow-up message",
      };

    case "daily_sync":
      return {
        shouldMessage: true,
        message: {
          intent: "Provide daily briefing",
          context: { syncType: trigger.data.syncType },
          tone: "neutral",
        },
        createReminders: [],
        updateReminders: [],
        silentActions: [],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to daily sync message",
      };

    case "integration_webhook":
      // Webhooks default to silent - don't spam user
      return {
        shouldMessage: false,
        createReminders: [],
        updateReminders: [],
        silentActions: [
          {
            type: "log",
            description: `Webhook received: ${trigger.data.integration} - ${trigger.data.eventType}`,
            data: { payload: trigger.data.payload },
          },
        ],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to silent logging for webhook",
      };

    case "scheduled_check":
      return {
        shouldMessage: false,
        createReminders: [],
        updateReminders: [],
        silentActions: [
          {
            type: "log",
            description: `Scheduled check completed: ${trigger.data.checkType}`,
          },
        ],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to silent for scheduled check",
      };

    default:
      return DEFAULT_ACTION_PLAN;
  }
}
