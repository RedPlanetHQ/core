/**
 * Trigger Pipeline
 *
 * A trigger fires (integration webhook, scheduled task, memory ingest,
 * reminder), we resolve/create the owning conversation, and run the
 * generalist (or task-assigned) agent on it. The agent decides what to do —
 * including whether to send a message via its own `send_message` /
 * integration tools. There's no separate think stage and no `shouldMessage`
 * gate; the agent owns delivery.
 */

import { UserTypeEnum } from "@core/types";
import { processInboundMessage } from "~/services/agent/message-processor";
import {
  type DecisionContext,
  type Trigger,
} from "~/services/agent/types/decision-agent";
import { getWorkspaceChannelContext } from "~/services/channel.server";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { logger } from "~/services/logger.service";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
import { getOrCreateAsyncConversation } from "~/services/agent/context/decision-context";
import { createConversation } from "~/services/conversation.server";
import { hasCredits } from "~/trigger/utils/utils";
import { isWorkspaceBYOK } from "~/services/byok.server";

// ============================================================================
// Types
// ============================================================================

export interface CASEPipelineInput {
  trigger: Trigger;
  context: DecisionContext;
  userPersona?: string;
  userData: {
    userId: string;
    email: string;
    phoneNumber?: string;
    workspaceId: string;
  };
  /** Text to use as the "[Trigger fired]" system message */
  reminderText: string;
  /** ID for logging and state updates */
  reminderId: string;
  timezone: string;
  /** Optional tool executor — defaults to DirectOrchestratorTools (direct DB calls) */
  executorTools?: OrchestratorTools;
  /** Unified task ID (when triggered from scheduled task) */
  taskId?: string;
  /** Unified task text (when triggered from scheduled task) */
  taskText?: string;
  /** When true, always create a new conversation instead of reusing an existing one */
  forceNewConversation?: boolean;
  /** Owning agent for the created/reused conversation. When the fire is
   *  scoped to a task, callers should pass the task's assignedAgentId (with
   *  a generalist fallback) so context.ts renders the right agent's basePrompt
   *  instead of defaulting to the workspace generalist. */
  agentId?: string;
}

export interface CASEPipelineResult {
  success: boolean;
  error?: string;
  /** The conversation ID used for this pipeline run */
  conversationId?: string;
  /** The agent's final synthesized text (if any). */
  responseText?: string;
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Route a trigger to the owning agent (generalist by default, or the task's
 * assigned agent). The agent decides whether to reply, send a message,
 * silently update state, or all of the above — all via its own tools.
 */
export async function runCASEPipeline(
  input: CASEPipelineInput,
): Promise<CASEPipelineResult> {
  const {
    trigger,
    context,
    userPersona,
    userData,
    reminderText,
    reminderId,
    executorTools,
    taskId,
    taskText,
    forceNewConversation,
    agentId: pipelineAgentId,
  } = input;

  // Use unified task fields when available, fall back to reminder fields
  const entityId = taskId ?? reminderId;
  const entityText = taskText ?? reminderText;

  // Pre-flight credit check. BYOK workspaces bypass credits entirely.
  // Fail fast before creating a conversation or invoking the model — running
  // the pipeline on an empty balance would just fail deep inside the LLM call.
  const isBYOK = await isWorkspaceBYOK(userData.workspaceId);
  if (!isBYOK) {
    const hasSufficientCredits = await hasCredits(
      userData.workspaceId,
      userData.userId,
      "chatMessage",
    );
    if (!hasSufficientCredits) {
      logger.warn(
        `[pipeline] Insufficient credits for ${entityId}; skipping pipeline`,
      );
      return {
        success: false,
        error: "insufficient_credits",
      };
    }
  }

  try {
    // =========================================================================
    // Get or create conversation for this async job. Source = trigger type
    // slug so the sidebar History popover surfaces it under the right label
    // ("gmail", "linear", "scheduled-task", ...).
    // =========================================================================
    const conversationSource =
      trigger.type === "integration_webhook"
        ? ((trigger.data as any).integration ?? "integration")
        : trigger.type === "scheduled_task_fired"
          ? "scheduled-task"
          : trigger.type === "memory_ingest"
            ? `memory-ingest:${(trigger.data as any).source ?? "unknown"}`
            : "reminder";

    let conversationId: string;

    if (forceNewConversation) {
      // Always create a fresh conversation for this run. Passing agentId
      // here pins the row to the correct agent up front so context.ts loads
      // that agent's basePrompt on the very first turn (rather than falling
      // back to the workspace generalist).
      const convResult = await createConversation(
        userData.workspaceId,
        userData.userId,
        {
          message: entityText,
          parts: [{ text: entityText, type: "text" }],
          source: conversationSource,
          asyncJobId: entityId,
          userType: UserTypeEnum.System,
          ...(pipelineAgentId ? { agentId: pipelineAgentId } : {}),
        },
      );
      conversationId = convResult.conversationId;
    } else {
      // Reuse the existing per-(agent, source) thread when one exists so
      // triggers append to the endless-scroll history instead of spawning a
      // fresh row per event.
      conversationId = await getOrCreateAsyncConversation(
        userData.workspaceId,
        userData.userId,
        entityId,
        conversationSource,
        entityText,
      );
    }

    // =========================================================================
    // Resolve channel type from Channel table (trigger.channel is a name now)
    // =========================================================================
    const channelCtx = await getWorkspaceChannelContext(userData.workspaceId);
    const resolved = channelCtx.resolveChannel(trigger.channel);
    const channelType: ChannelType = (resolved?.channelType ??
      channelCtx.defaultChannelType) as ChannelType;

    // =========================================================================
    // Hand off to the agent. The agent decides everything from here — whether
    // to reply, send a message, update state, spawn a subtask — via its own
    // tool set. No think stage, no shouldMessage gate.
    // =========================================================================
    logger.info(`[pipeline] Running agent for ${entityId}`);

    const { responseText } = await processInboundMessage({
      userId: userData.userId,
      workspaceId: userData.workspaceId,
      channel: channelType,
      userMessage: `[Trigger fired] ${entityText}`,
      conversationId,
      skipUserMessage: true,
      messageUserType: UserTypeEnum.System,
      triggerContext: {
        trigger,
        context,
        reminderText: entityText,
        userPersona,
      },
      executorTools,
    });

    logger.info(`[pipeline] Successfully processed ${entityId}`);

    return {
      success: true,
      conversationId,
      responseText,
    };
  } catch (error) {
    logger.error(`[pipeline] Failed for ${entityId}`, { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
