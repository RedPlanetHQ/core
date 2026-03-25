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

import { stepCountIs } from "ai";
import { Agent } from "@mastra/core/agent";
import { toRouterString, getModelForTask } from "~/lib/model.server";
import { getMastra } from "../mastra";

import {
  type Trigger,
  type DecisionContext,
  type ActionPlan,
  type DecisionAgentResult,
} from "../types/decision-agent";
import { buildDecisionAgentPrompt } from "../prompts";
import { logger } from "../../logger.service";
import { createCoreTools } from "./core";
import { createOrchestratorAgent } from "./orchestrator";
import { prisma } from "~/db.server";
import { type OrchestratorTools } from "../executors/base";
import { getSkillTool } from "../tools/skill-tools";
import { getReminderTools } from "../tools/reminder-tools";

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
export function normalizeActionPlan(plan: ActionPlan): ActionPlan {
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
 * Create a thinking agent with gather_context as subagent.
 * Used as a subagent on the core agent when triggerContext is present.
 */
export function createThinkAgent(
  gatherContextAgent: Agent,
  workspaceId: string,
  channel: string,
  timezone: string,
  availableChannels: Array<"whatsapp" | "slack" | "email">,
  minRecurrenceMinutes: number,
): Agent {
  const tools: Record<string, any> = {};
  tools["get_skill"] = getSkillTool(workspaceId);

  const reminderTools = getReminderTools(
    workspaceId,
    channel,
    timezone,
    availableChannels,
    minRecurrenceMinutes,
  );

  const thinkAgent = new Agent({
    id: "thinking-agent",
    name: "Think",
    model: toRouterString(getModelForTask("low")) as any,
    instructions: "Analyze triggers and produce structured JSON action plans.",
    agents: { gather_context: gatherContextAgent },
    tools: { ...tools, ...reminderTools },
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
