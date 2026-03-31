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

import { Agent } from "@mastra/core/agent";
import { toRouterString, resolveModelString } from "~/lib/model.server";
import { type ModelConfig } from "~/services/llm-provider.server";
import { getMastra } from "../mastra";

import {
  type Trigger,
  type DecisionContext,
  type ActionPlan,
} from "../types/decision-agent";
import { getSkillTool } from "../tools/skill-tools";
import { buildDecisionAgentPrompt } from "../prompts/decision-prompt";
import { type SkillRef } from "../types";

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
  createFollowUps: [],
  updateTasks: [],
  silentActions: [],
  reasoning: "Default plan - Decision Agent produced no valid output",
};

/**
 * Parse JSON from model response, handling common formatting issues
 */
export function parseActionPlan(text: string): ActionPlan | null {
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
  if (plan.createFollowUps && !Array.isArray(plan.createFollowUps))
    return false;
  if (plan.updateTasks && !Array.isArray(plan.updateTasks))
    return false;
  if (plan.silentActions && !Array.isArray(plan.silentActions)) return false;

  return true;
}

/**
 * Normalize action plan to ensure all optional fields have defaults
 */
export function normalizeActionPlan(plan: ActionPlan): ActionPlan {
  return {
    shouldMessage: plan.shouldMessage,
    message: plan.message,
    createFollowUps: plan.createFollowUps || [],
    updateTasks: plan.updateTasks || [],
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
 * Create a thinking agent with gather_context as subagent.
 * Used as a subagent on the core agent when triggerContext is present.
 */
export async function createThinkAgent(
  gatherContextAgent: Agent,
  workspaceId: string,
  _userId: string,
  _channel: string,
  timezone: string,
  _availableChannels: string[],
  _minRecurrenceMinutes: number,
  modelConfig?: ModelConfig,
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    userPersona?: string;
  },
  skills?: SkillRef[],
): Promise<Agent> {
  // Think only has gather_context (subagent) and get_skill for informed reasoning.
  // All execution (create_task, send_message, etc.) is done by the core agent
  // based on the ActionPlan that think returns.
  const tools: Record<string, any> = {};
  tools["get_skill"] = getSkillTool(workspaceId);

  // Build the full decision prompt with trigger + context
  const currentTime = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const instructions = triggerContext
    ? buildDecisionAgentPrompt(
        JSON.stringify(triggerContext.trigger, null, 2),
        JSON.stringify(triggerContext.context, null, 2),
        currentTime,
        timezone,
        triggerContext.userPersona,
        skills,
      )
    : "Analyze triggers and produce structured JSON action plans.";

  const model = await resolveModelString("chat", "low");
  const thinkAgent = new Agent({
    id: "thinking-agent",
    name: "Think",
    model: modelConfig ?? toRouterString(model),
    instructions,
    agents: { gather_context: gatherContextAgent },
    tools,
  });

  const mastra = getMastra();
  (thinkAgent as any).__registerMastra(mastra);

  return thinkAgent;
}

/**
 * Create a contextual fallback plan based on trigger type
 */
export function createFallbackPlan(trigger: Trigger): ActionPlan {
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
        createFollowUps: [],
        updateTasks: [],
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
        createFollowUps: [],
        updateTasks: [],
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
        createFollowUps: [],
        updateTasks: [],
        silentActions: [],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to daily sync message",
      };

    case "integration_webhook":
      return {
        shouldMessage: false,
        createFollowUps: [],
        updateTasks: [],
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
        createFollowUps: [],
        updateTasks: [],
        silentActions: [
          {
            type: "log",
            description: `Scheduled check completed: ${trigger.data.checkType}`,
          },
        ],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to silent for scheduled check",
      };

    case "scheduled_task_fired":
      return {
        shouldMessage: true,
        message: {
          intent: `Execute scheduled task: ${trigger.data.action}`,
          context: {
            action: trigger.data.action,
            taskId: trigger.data.taskId,
          },
          tone: "neutral",
        },
        createFollowUps: [],
        updateTasks: [],
        silentActions: [],
        reasoning:
          "Fallback: Decision Agent failed, defaulting to message for scheduled task",
      };

    default:
      return DEFAULT_ACTION_PLAN;
  }
}
