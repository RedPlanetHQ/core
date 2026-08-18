/**
 * Core Agent Tool & Agent Assembly
 *
 * Two entry points:
 *  - `createCoreTools()` — builds all non-orchestrator tools (sleep, acknowledge,
 *    tasks, skills).
 *  - `createCoreAgents()` — builds gather_context, take_action, and optionally
 *    think subagents via Mastra's native `agents: {}` mechanism.
 */

import { type Tool } from "ai";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";

import { type SkillRef } from "../types";
import { type ModelConfig } from "~/services/llm-provider.server";
import {
  type OrchestratorTools,
  type GatewayAgentInfo,
} from "../executors/base";
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
import { getReadFileTool } from "../tools/file-tools";
import { getMemorySearchTool } from "../tools/memory-tools";
import { DirectOrchestratorTools } from "../executors";
import {
  getListAvailableIntegrationsTool,
  getSuggestIntegrationsTool,
  getCompleteOnboardingTool,
} from "../tools/onboarding-tools";
// Widget tools temporarily removed from the main agent's surface. Their
// factories still live in ../tools/widget-tools; re-import when we bring
// the inline widget affordance back.
import { buildOrchestratorTools } from "./orchestrator";
import { createGatewayAgents } from "./gateway";
import { getWorkspaceChannelContext } from "~/services/channel.server";
import { toRouterString } from "~/lib/model.server";
import { getDefaultChatModelId } from "~/services/llm-provider.server";
import { stepCountIs } from "ai";

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
  /** Channel name from the trigger's task config (for send_message tool) */
  triggerChannel?: string;
  /** Channel ID from the trigger's task config (for send_message tool) */
  triggerChannelId?: string | null;
  /** User email for send_message fallback */
  userEmail?: string;
  /** User phone for send_message WhatsApp delivery */
  userPhoneNumber?: string;
  /** Executor tools — used to resolve gateways and call tools in non-websocket contexts */
  executorTools?: OrchestratorTools;
  /** User persona — passed through to the orchestrator tool block (mirrors
   *  what the read/write sub-agents used to receive). */
  persona?: string;
  /** Interactive turns get requireApproval on risky integration writes.
   *  Non-interactive (scheduled/background) callers pass false. */
  interactive?: boolean;
  /** Resolved model config — needed by spawn_subagent so a spawned sub-turn
   *  runs on the same model as the main agent. */
  modelConfig?: ModelConfig;
  /** The agent id driving THIS turn. Used by list_colleagues to exclude
   *  self, and by delegate_to_agent to block self-delegation. Null when the
   *  caller hasn't resolved an agent yet. */
  currentAgentId?: string | null;
  /** The human user's display name — piped into delegated sub-turns so the
   *  target agent's `{{USER_NAME}}` substitutes correctly. */
  userName?: string;
  /** The conversation this turn is running against. Used by
   *  delegate_to_agent to post the delegated agent's reply back into the
   *  same conversation, attributed to that agent. */
  conversationId?: string | null;
}

interface CreateCoreAgentsParams {
  userId: string;
  workspaceId: string;
  timezone: string;
  source: string;
  persona?: string;
  skills?: SkillRef[];
  executorTools?: OrchestratorTools;
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

  // Load a file at a URL into the model context (images, PDFs, text).
  // Works against external URLs and internal /api/v1/storage attachments.
  tools["read_file"] = getReadFileTool(userId);

  // Their memory — direct recall, no orchestrator hop. Available in every
  // context (interactive, background, triggers) so the butler consults
  // memory before composing or delegating. Same executor fallback as the
  // orchestrators (orchestrator.ts:302).
  tools["memory_search"] = getMemorySearchTool({
    userId,
    workspaceId,
    source,
    executor: executorTools ?? new DirectOrchestratorTools(),
  });

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

  // Inline-widget catalog — temporarily removed. The main agent doesn't
  // emit inline widgets in the current UI. Bring these back when we
  // re-introduce widget rendering in chat.
  //
  //   tools["get_supported_widgets"] = getSupportedWidgetsTool();
  //   tools["get_widget_info"] = getWidgetInfoTool();

  // complete_onboarding — only while user.onboardingComplete === false.
  // Flips the flag and persists the final profile summary.
  if (isOnboardingMode) {
    tools["complete_onboarding"] = getCompleteOnboardingTool(userId);
  }

  // `acknowledge` was removed on both the core and orchestrator sides —
  // `progress_update` covers the same "on it" narration for interactive
  // and background contexts alike.

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

  // Unified task tools (includes scheduling / recurring)
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
          currentTaskId,
        })
      : {};

  // Skill tools
  tools["get_skill"] = getSkillTool(workspaceId);
  if (!readOnly) {
    tools["update_skill"] = updateSkillTool(workspaceId, userId);
    if (!isBackgroundExecution) {
      tools["create_skill"] = createSkillTool(workspaceId, userId);
    }
  }

  // Session lookup tools — only relevant inside task execution (they read
  // the running task's coding/browser sessions). Skip in interactive chat
  // so the tool surface stays lean.
  const sessionTools =
    currentTaskId || isBackgroundExecution
      ? getSessionTools({ workspaceId, currentTaskId })
      : {};

  // Orchestrator tools — integrations, docs, web search, acknowledge, etc.
  // Previously these lived on the gather_context / take_action sub-agents.
  // Now the main agent owns them directly (no delegation hop).
  const { tools: orchestratorTools } = await buildOrchestratorTools(
    userId,
    workspaceId,
    timezone,
    source,
    params.persona,
    skills,
    executorTools,
    params.interactive ?? true,
    params.modelConfig,
  );

  // Aggregate the main agent's toolset. spawn_subagent is added after this
  // block so its execute-time closure can reference the final tool map
  // (including itself, letting a sub-agent spawn its own sub-agents).
  const allTools: Record<string, Tool> = {
    ...tools,
    ...taskTools,
    ...messageTools,
    ...sessionTools,
    ...orchestratorTools,
  };

  // Colleague delegation is no longer a tool. Agents hand off by emitting
  // <mention colleague="handle" /> in their reply; dispatchMentions parses
  // the row after it lands and spawns a background turn for each mentioned
  // agent. See ~/services/agent/dispatch-mentions.ts.

  // spawn_subagent — lets the main agent create a fresh instance of itself
  // to run a delimited sub-task in an isolated context. The child inherits
  // the current turn's model + full tool set (including this same spawn
  // tool so a sub-agent can spawn its own sub-agents). Returns the child's
  // final synthesized text.
  //
  // For now the child uses a generic sub-agent instruction rather than the
  // parent's system prompt — the parent's prompt isn't finalized at
  // createCoreTools time. Passing the parent prompt through would need a
  // reorder in context.ts and is a follow-up.
  const modelConfig = params.modelConfig;

  allTools.spawn_subagent = createTool({
    id: "spawn_subagent",
    description:
      "Spawn a fresh sub-instance of yourself to run a delimited task in an isolated context. The sub-agent has the same tools and model you do. Use for parallelizable work or when you want to keep the sub-turn's tool-call chatter out of your own thread. Returns the sub-agent's final text.",
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          "Full self-contained instruction for the sub-agent — as if you were briefing another instance of yourself. Include all context it needs; the sub-agent starts fresh.",
        ),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Optional step-count cap for the sub-turn. Defaults to 20."),
    }),
    execute: async (input) => {
      const resolvedModel =
        modelConfig ?? (toRouterString(getDefaultChatModelId()) as any);
      const child = new Agent({
        id: `subagent-${Date.now()}`,
        name: "Subagent",
        model: resolvedModel as any,
        instructions:
          "You are a sub-agent spawned by the main agent to complete a delimited task. You have the same tools your parent does. Work efficiently, use tools as needed, and return a concise final answer.",
        tools: allTools,
      });
      const stream = await child.stream(
        [{ role: "user", content: input.task }],
        { stopWhen: [stepCountIs(input.maxSteps ?? 20)] },
      );
      let text = "";
      for await (const part of (stream as any).textStream ?? []) {
        text += typeof part === "string" ? part : "";
      }
      if (!text && typeof (stream as any).text === "string") {
        text = (stream as any).text;
      }
      return text || "(sub-agent produced no output)";
    },
  }) as unknown as Tool;

  return allTools;
}

// ask_user + the requireApproval-driven tool-approval flow were retired
// alongside the useChat → fire-and-forget migration. Agents that need
// clarification just ask the user in plain text; the user replies as a
// normal turn and the agent picks it up next cycle. The removed tool
// factory lived here and its client-side scaffolding lived under
// components/conversation/tool-approval-panel + tool-ui/ask-user-question
// — check git history if reintroduction becomes necessary.

// ---------------------------------------------------------------------------
// createCoreAgents — orchestrator + gateway subagents
// ---------------------------------------------------------------------------

export async function createCoreAgents(
  params: CreateCoreAgentsParams,
): Promise<{
  gatewayAgents: Agent[];
}> {
  const {
    userId,
    workspaceId,
    executorTools,
    interactive = true,
    modelConfig,
    conversationId,
    taskId,
    skills,
  } = params;

  // Gateway-backed agents are still real Mastra sub-agents — each one wraps
  // a remote gateway's tool set behind a per-gateway HTTP client. The main
  // agent delegates to them by name. This is distinct from the removed
  // gather_context / take_action / think delegation model.
  const gateways: GatewayAgentInfo[] = executorTools
    ? await executorTools.getGateways(workspaceId)
    : (
        await prisma.gateway.findMany({
          where: { workspaceId },
          select: { id: true, name: true, status: true, description: true },
        })
      ).map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description ?? "",
        baseUrl: "",
        tools: [],
        platform: null,
        hostname: null,
        status: g.status as "CONNECTED" | "DISCONNECTED",
      }));

  const { agentList: gatewayAgents } = await createGatewayAgents(
    gateways,
    executorTools,
    interactive,
    modelConfig,
    {
      conversationId,
      taskId,
      workspaceId,
      userId,
    },
    skills,
  );

  return { gatewayAgents };
}
