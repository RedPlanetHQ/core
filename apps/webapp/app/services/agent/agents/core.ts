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
import { createTool } from "@mastra/core/tools";

import { type SkillRef } from "../types";
import { type ModelConfig } from "~/services/llm-provider.server";
import { type OrchestratorTools } from "../executors/base";
import { type Trigger, type DecisionContext } from "../types/decision-agent";
import { createThinkAgent } from "./decision";
import { logger } from "../../logger.service";
import { prisma } from "~/db.server";
import {
  getSkillTool,
  createSkillTool,
  updateSkillTool,
} from "../tools/skill-tools";
import { getTaskTools } from "../tools/task-tools";
import { getMessageTools } from "../tools/message-tools";
import { getSessionTools } from "../tools/session-tools";
import { getSleepTool, getProgressUpdateTool } from "../tools/utils-tools";
import {
  getListAvailableIntegrationsTool,
  getSuggestIntegrationsTool,
  getCompleteOnboardingTool,
} from "../tools/onboarding-tools";
import { createOrchestratorAgent } from "./orchestrator";
import { createGatewayAgents } from "./gateway";
import { getWorkspaceChannelContext } from "~/services/channel.server";

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
  defaultChannel?: string;
  availableChannels?: string[];
  isBackgroundExecution?: boolean;
  /** True when user.onboardingComplete === false — enables complete_onboarding on the main agent. (progress_update and suggest_integrations are globally available.) */
  isOnboardingMode?: boolean;
  /** Task ID when running as a background task (for reschedule_self tool) */
  currentTaskId?: string;
  /** Channel name from trigger's reminder config (for send_message tool) */
  triggerChannel?: string;
  /** Channel ID from trigger's reminder config (for send_message tool) */
  triggerChannelId?: string | null;
  /** User email for send_message fallback */
  userEmail?: string;
  /** User phone for send_message WhatsApp delivery */
  userPhoneNumber?: string;
  /** Executor tools — used to resolve gateways and call tools in non-websocket contexts */
  executorTools?: OrchestratorTools;
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
  defaultChannel?: string;
  availableChannels?: string[];
  minRecurrenceMinutes?: number;
  /** When false, tools run without requireApproval */
  interactive?: boolean;
  /** Resolved model config (string or OpenAICompatibleConfig for BYOK) */
  modelConfig?: ModelConfig;
  /** Conversation context for recording coding sessions */
  conversationId?: string;
  taskId?: string;
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
    isOnboardingMode,
    currentTaskId,
    triggerChannel,
    triggerChannelId,
    userEmail,
    userPhoneNumber,
    executorTools,
  } = params;

  const tools: Record<string, Tool> = {};

  // Sleep tool
  tools["sleep"] = getSleepTool();

  // Progress narration — available globally so any long-running step
  // (delegations, syntheses) can keep the user informed.
  tools["progress_update"] = getProgressUpdateTool();

  // Integration catalog — global. Agent calls this before
  // suggest_integrations to see which slugs are valid and which are
  // already connected for this workspace.
  tools["list_available_integrations"] = getListAvailableIntegrationsTool(
    userId,
    workspaceId,
  );

  // suggest_integrations — global. Agent may offer connect cards
  // anytime, not just during onboarding.
  tools["suggest_integrations"] = getSuggestIntegrationsTool();

  // complete_onboarding — only while user.onboardingComplete === false.
  // Flips the flag and persists the final profile summary.
  if (isOnboardingMode) {
    tools["complete_onboarding"] = getCompleteOnboardingTool(userId);
  }

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

  // Resolve channel context for task tools
  const channel =
    source === "whatsapp"
      ? "whatsapp"
      : source === "slack"
        ? "slack"
        : defaultChannel || "email";

  const [subscription, channelCtx] = await Promise.all([
    prisma.subscription.findFirst({
      where: {
        workspace: { id: workspaceId },
        status: "ACTIVE",
      },
      select: { planType: true },
    }),
    getWorkspaceChannelContext(workspaceId),
  ]);
  const minRecurrenceMinutes =
    subscription?.planType === "FREE" || !subscription ? 60 : 30;

  // Unified task tools (includes scheduling / recurring — replaces reminder tools)
  const taskTools = readOnly
    ? {}
    : getTaskTools(
        workspaceId,
        userId,
        isBackgroundExecution,
        timezone,
        channel as any,
        availableChannels || (channelCtx.availableTypes as any) || ["email"],
        minRecurrenceMinutes,
        channelCtx.channels,
        currentTaskId,
        source,
      );

  // Message tools (only in trigger or background task contexts — NOT in webapp
  // interactive sessions where the user is already reading the streamed response)
  const isWebappInteractive = source === "core";
  const messageTools =
    !isWebappInteractive && (isBackgroundExecution || triggerChannel)
      ? getMessageTools({
          workspaceId,
          userId,
          userEmail: userEmail ?? "",
          userPhoneNumber,
          triggerChannel,
          triggerChannelId,
        })
      : {};

  // Skill tools
  tools["get_skill"] = getSkillTool(workspaceId);
  if (!readOnly && !isBackgroundExecution) {
    tools["create_skill"] = createSkillTool(workspaceId, userId);
    tools["update_skill"] = updateSkillTool(workspaceId, userId);
  }

  // Session lookup tools — replace the previous prompt-injection of last
  // coding/browser session details. Available in every context (interactive
  // chat too, for asking "what was the session for that task?").
  const sessionTools = getSessionTools({ workspaceId, currentTaskId });

  return { ...tools, ...taskTools, ...messageTools, ...sessionTools };
}

// ---------------------------------------------------------------------------
// createAskUserTool — must be registered directly on the Agent (not toolsets)
// so Mastra's requireApproval middleware applies correctly on approveToolCall.
// ---------------------------------------------------------------------------

export function createAskUserTool() {
  return createTool({
    id: "ask_user",
    description:
      "Ask the user 1–4 questions during execution. Use this to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer direction options. Don't overuse — only ask when you genuinely can't proceed without the answer.",
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z
              .string()
              .describe(
                "The complete question to ask. Should be clear and specific, ending with a question mark.",
              ),
            header: z
              .string()
              .optional()
              .describe(
                "Very short label shown as a chip (max 12 chars). E.g. 'Auth method', 'Priority'.",
              ),
            options: z
              .array(
                z.object({
                  label: z
                    .string()
                    .describe("Display text for this option (1–5 words)"),
                  description: z
                    .string()
                    .optional()
                    .describe(
                      "Explanation of what this option means or its trade-offs",
                    ),
                  markdown: z
                    .string()
                    .optional()
                    .describe(
                      "Optional preview content (code snippet, ASCII mockup) shown when this option is focused",
                    ),
                }),
              )
              .min(2)
              .max(4)
              .describe(
                "2–4 mutually exclusive options for the user to choose from",
              ),
            multiSelect: z
              .boolean()
              .optional()
              .default(false)
              .describe(
                "Set true to allow the user to select multiple options",
              ),
          }),
        )
        .min(1)
        .max(4)
        .describe("1–4 questions to ask the user"),
      answers: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "The user's answers keyed by question text — set automatically when the user responds, do not set this yourself",
        ),
      annotations: z
        .record(
          z.string(),
          z.object({
            markdown: z.string().optional(),
            notes: z.string().optional(),
          }),
        )
        .optional()
        .describe("Per-answer annotations from the user — set automatically"),
    }),
    requireApproval: true,
    execute: async (inputData, args) => {
      // The user's answers are sent as toolArgOverrides and must be read
      // from requestContext — they are NOT auto-applied to inputData.
      const ctx = args as {
        agent?: { toolCallId?: string };
        requestContext?: { get: (key: string) => unknown };
      };
      const callId = ctx?.agent?.toolCallId;
      const overrideRaw = ctx?.requestContext?.get("toolArgsOverride");

      let answers = inputData.answers;
      let annotations = inputData.annotations;

      if (callId && overrideRaw) {
        try {
          const overrideMap: Record<
            string,
            Record<string, unknown>
          > = typeof overrideRaw === "string"
            ? JSON.parse(overrideRaw)
            : (overrideRaw as Record<string, Record<string, unknown>>);
          if (overrideMap[callId]) {
            answers =
              (overrideMap[callId].answers as typeof answers) ?? answers;
            annotations =
              (overrideMap[callId].annotations as typeof annotations) ??
              annotations;
          }
        } catch {
          // fall through to original inputData
        }
      }

      return { answers: answers ?? {}, annotations: annotations ?? {} };
    },
  });
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
    conversationId,
    taskId,
  } = params;

  // Load gateways for subagent creation
  const gateways = executorTools
    ? await executorTools.getGateways(workspaceId)
    : await prisma.gateway.findMany({
        where: { workspaceId },
        select: { id: true, name: true, status: true, description: true },
      });

  const [reader, writer, { agentList: gatewayAgents }] = await Promise.all([
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
    createGatewayAgents(gateways, executorTools, interactive, modelConfig, {
      conversationId,
      taskId,
      workspaceId,
      userId,
    }),
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
        userId,
        channel,
        timezone,
        availableChannels || ["email"],
        minRecurrenceMinutes ?? 60,
        modelConfig,
        triggerContext,
        skills,
      )
    : undefined;

  return {
    gatherContextAgent: reader.agent,
    takeActionAgent: writer.agent,
    thinkAgent,
    gatewayAgents,
  };
}
