/**
 * Core Agent Tool & Agent Assembly
 *
 * Two entry points:
 *  - `createCoreTools()` — builds all non-orchestrator tools (sleep, acknowledge,
 *    reminders, tasks, skills).
 *  - `createCoreAgents()` — builds gather_context, take_action, and optionally
 *    think subagents via Mastra's native `agents: {}` mechanism.
 */

import { type Tool, tool } from "ai";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";

import { type SkillRef } from "../types";
import { type ModelConfig } from "~/services/llm-provider.server";
import { type OrchestratorTools } from "../executors/base";
import { type Trigger, type DecisionContext } from "../types/decision-agent";
import { createThinkAgent } from "./decision";
import { logger } from "../../logger.service";
import { prisma } from "~/db.server";
import { getReminderTools } from "../tools/reminder-tools";
import {
  getSkillTool,
  createSkillTool,
  updateSkillTool,
} from "../tools/skill-tools";
import { getTaskTools } from "../tools/task-tools";
import { getSleepTool } from "../tools/utils-tools";
import { createOrchestratorAgent } from "./orchestrator";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

interface CreateCoreToolsParams {
  userId: string;
  workspaceId: string;
  timezone: string;
  source: string;
  readOnly?: boolean;
  skills?: SkillRef[];
  onMessage?: (message: string) => Promise<void>;
  defaultChannel?: "whatsapp" | "slack" | "email";
  availableChannels?: Array<"whatsapp" | "slack" | "email">;
  isBackgroundExecution?: boolean;
}

interface CreateCoreAgentsParams {
  userId: string;
  workspaceId: string;
  timezone: string;
  source: string;
  persona?: string;
  skills?: SkillRef[];
  executorTools?: OrchestratorTools;
  triggerContext?: {
    trigger: Trigger;
    context: DecisionContext;
    userPersona?: string;
  };
  /** For think agent tools */
  defaultChannel?: "whatsapp" | "slack" | "email";
  availableChannels?: Array<"whatsapp" | "slack" | "email">;
  minRecurrenceMinutes?: number;
  /** When false, tools run without requireApproval */
  interactive?: boolean;
  /** Resolved model config (string or OpenAICompatibleConfig for BYOK) */
  modelConfig?: ModelConfig;
}

// ---------------------------------------------------------------------------
// createCoreTools — all non-orchestrator tools for core agent
// ---------------------------------------------------------------------------

export async function createCoreTools(
  params: CreateCoreToolsParams,
): Promise<Record<string, Tool>> {
  const {
    userId,
    workspaceId,
    timezone,
    source,
    readOnly = false,
    skills,
    onMessage,
    defaultChannel,
    availableChannels,
    isBackgroundExecution,
  } = params;

  const tools: Record<string, Tool> = {};

  // Sleep tool
  tools["sleep"] = getSleepTool();

  // Acknowledge tool for channels with intermediate message support
  if (onMessage) {
    tools["acknowledge"] = tool({
      description:
        "Send a quick heads-up to the user on their channel before you start working. Call this BEFORE delegating to the orchestrator so they know you're on it. One short message per conversation — don't spam.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            'One short sentence. Max 6 words. Examples: "on it.", "let me check.", "looking into it.", "one sec."',
          ),
      }),
      execute: async ({ message }) => {
        logger.info(`Core brain: Acknowledging: ${message}`);
        await onMessage(message);
        return "acknowledged";
      },
    });
  }

  // Reminder tools
  const channel =
    source === "whatsapp"
      ? "whatsapp"
      : source === "slack"
        ? "slack"
        : defaultChannel || "email";

  const subscription = await prisma.subscription.findFirst({
    where: {
      workspace: { id: workspaceId },
      status: "ACTIVE",
    },
    select: { planType: true },
  });
  const minRecurrenceMinutes =
    subscription?.planType === "FREE" || !subscription ? 60 : 30;

  const reminderTools = getReminderTools(
    workspaceId,
    channel,
    timezone,
    availableChannels || ["email"],
    minRecurrenceMinutes,
  );

  // Task tools (only in write mode)
  const taskTools = readOnly
    ? {}
    : getTaskTools(workspaceId, userId, isBackgroundExecution);

  // Skill tools
  tools["get_skill"] = getSkillTool(workspaceId);
  if (!readOnly) {
    tools["create_skill"] = createSkillTool(workspaceId, userId);
    tools["update_skill"] = updateSkillTool(workspaceId, userId);
  }

  return { ...tools, ...reminderTools, ...taskTools };
}

// ---------------------------------------------------------------------------
// createCoreAgents — orchestrator + gateway subagents
// ---------------------------------------------------------------------------

export async function createCoreAgents(
  params: CreateCoreAgentsParams,
): Promise<{
  gatherContextAgent: Agent;
  takeActionAgent: Agent;
  thinkAgent?: Agent;
  gatewayAgents: Agent[];
}> {
  const {
    userId,
    workspaceId,
    timezone,
    source,
    persona,
    skills,
    executorTools,
    triggerContext,
    defaultChannel,
    availableChannels,
    minRecurrenceMinutes,
    interactive = true,
    modelConfig,
  } = params;

  const [reader, writer] = await Promise.all([
    createOrchestratorAgent(
      userId,
      workspaceId,
      "read",
      timezone,
      source,
      persona,
      skills,
      executorTools,
      interactive,
      modelConfig,
    ),
    createOrchestratorAgent(
      userId,
      workspaceId,
      "write",
      timezone,
      source,
      persona,
      skills,
      executorTools,
      interactive,
      modelConfig,
    ),
  ]);

  // Think agent — only when triggered (reminders, webhooks, scheduled jobs)
  const channel =
    source === "whatsapp"
      ? "whatsapp"
      : source === "slack"
        ? "slack"
        : defaultChannel || "email";

  const thinkAgent = triggerContext
    ? await createThinkAgent(
        reader.agent,
        workspaceId,
        channel,
        timezone,
        availableChannels || ["email"],
        minRecurrenceMinutes ?? 60,
        modelConfig,
      )
    : undefined;

  return {
    gatherContextAgent: reader.agent,
    takeActionAgent: writer.agent,
    thinkAgent,
    gatewayAgents: reader.gatewayAgents,
  };
}
