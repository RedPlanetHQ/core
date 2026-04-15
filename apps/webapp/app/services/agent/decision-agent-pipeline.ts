/**
 * Decision Agent Pipeline
 *
 * Trigger pipeline: takes a trigger + context, runs the butler with think enabled.
 * Message delivery is handled by the butler via send_message tool.
 *
 * Flow:
 * 1. Butler starts with trigger context + think tool
 * 2. Butler calls think (subagent) → gets ActionPlan
 * 3. Butler executes the plan (skills, integrations, tasks, send_message)
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
import { prisma } from "~/db.server";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
import { getOrCreateAsyncConversation } from "~/services/agent/context/decision-context";
import { createConversation } from "~/services/conversation.server";
import { deductCredits } from "~/trigger/utils/utils";
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
  /** Text to use as the "[Reminder triggered]" system message */
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
}

export interface CASEPipelineResult {
  success: boolean;
  shouldMessage: boolean;
  reasoning: string;
  error?: string;
  /** The conversation ID used for this pipeline run */
  conversationId?: string;
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Run the trigger pipeline.
 *
 * 1. Butler starts with think tool enabled
 * 2. Butler calls think → gets ActionPlan (shouldMessage, intent, etc.)
 * 3. Butler executes (skills, integrations, tasks, crafts message)
 * 4. Pipeline extracts shouldMessage from think output → delivers or skips
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
    timezone,
    executorTools,
    taskId,
    taskText,
    forceNewConversation,
  } = input;

  // Use unified task fields when available, fall back to reminder fields
  const entityId = taskId ?? reminderId;
  const entityText = taskText ?? reminderText;

  try {
    // =========================================================================
    // Get or create conversation for this async job
    // =========================================================================
    const conversationSource =
      trigger.type === "integration_webhook"
        ? ((trigger.data as any).integration ?? "integration")
        : trigger.type === "scheduled_task_fired"
          ? "scheduled-task"
          : "reminder";

    let conversationId: string;

    if (forceNewConversation) {
      // Always create a fresh conversation for this run
      const convResult = await createConversation(
        userData.workspaceId,
        userData.userId,
        {
          message: entityText,
          parts: [{ text: entityText, type: "text" }],
          source: conversationSource,
          asyncJobId: entityId,
          userType: UserTypeEnum.System,
        },
      );
      conversationId = convResult.conversationId;
    } else {
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
    // Run butler with think tool enabled
    // =========================================================================
    logger.info(`[pipeline] Running butler with think for ${entityId}`);

    const { responseText, parts } = await processInboundMessage({
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

    // =========================================================================
    // Extract shouldMessage from think tool output
    // =========================================================================
    const thinkPart = parts.find((p: any) => p.toolName === "think");
    const actionPlan = thinkPart?.output;
    const shouldMessage = actionPlan?.shouldMessage ?? true;
    const reasoning = actionPlan?.reasoning ?? "No think output found";

    logger.info(`[pipeline] Decision for ${entityId}`, {
      shouldMessage,
      reasoning,
      hasThinkOutput: !!thinkPart,
    });

    // =========================================================================
    // Message delivery is handled by the butler via send_message tool.
    // No code-based fallback — the trigger_context prompt instructs the butler
    // to call send_message when shouldMessage=true.
    // =========================================================================
    if (!shouldMessage) {
      logger.info(`[pipeline] Butler executed silently for ${entityId}`, {
        reasoning,
        responsePreview: responseText?.slice(0, 100),
      });
    }

    // =========================================================================
    // Execute silent actions from think output (log, update_state)
    // =========================================================================
    if (actionPlan?.silentActions) {
      for (const action of actionPlan.silentActions) {
        try {
          switch (action.type) {
            case "log": {
              logger.info(`[silent] ${action.description}`, {
                entityId,
                data: action.data,
              });
              break;
            }
            case "update_state": {
              await executeStateUpdate(
                action,
                trigger.userId,
                entityId,
                !!taskId,
              );
              break;
            }
            default:
              logger.warn(`Unknown silent action type: ${action.type}`);
          }
        } catch (error) {
          logger.error(`Failed to execute silent action: ${action.type}`, {
            entityId,
            error,
          });
        }
      }
    }

    // Deduct credits (1 for think-only, 2 if butler also ran full execution)
    // Skip credit deduction if workspace is using their own API key (BYOK)
    const isBYOK = await isWorkspaceBYOK(userData.workspaceId);
    if (!isBYOK) {
      try {
        await deductCredits(
          userData.workspaceId,
          userData.userId,
          "chatMessage",
          1, // noStreamProcess already deducts 1, so just 1 more for the pipeline
        );
      } catch (error) {
        logger.warn(`[pipeline] Failed to deduct credits for ${entityId}`, {
          error,
        });
      }
    }

    logger.info(`[pipeline] Successfully processed ${entityId}`);

    return {
      success: true,
      shouldMessage,
      reasoning,
      conversationId,
    };
  } catch (error) {
    logger.error(`[pipeline] Failed for ${entityId}`, { error });
    return {
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Execute state update — updates reminder metadata in database
 */
async function executeStateUpdate(
  action: { description: string; data?: Record<string, unknown> },
  userId: string,
  defaultEntityId: string,
  isTask: boolean = false,
) {
  const data = action.data || {};
  const targetId =
    (data.targetReminderId as string) ||
    (data.targetTaskId as string) ||
    defaultEntityId;

  logger.info(`[silent] State update: ${action.description}`, {
    userId,
    targetId,
    isTask,
  });

  const updateData: Record<string, unknown> = {};

  // Handle metadata merge
  if (data.metadata && typeof data.metadata === "object") {
    const table = isTask ? prisma.task : prisma.reminder;
    const existing = await (table as any).findUnique({
      where: { id: targetId },
      select: { metadata: true },
    });
    const existingMetadata =
      (existing?.metadata as Record<string, unknown>) || {};
    updateData.metadata = {
      ...existingMetadata,
      ...(data.metadata as Record<string, unknown>),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  if (typeof data.isActive === "boolean") {
    updateData.isActive = data.isActive;
    if (!data.isActive) {
      updateData.nextRunAt = null;
    }
  }

  if (typeof data.confirmedActive === "boolean") {
    updateData.confirmedActive = data.confirmedActive;
  }

  if (data.resetUnrespondedCount === true) {
    updateData.unrespondedCount = 0;
  }

  if (Object.keys(updateData).length > 0) {
    const table = isTask ? prisma.task : prisma.reminder;
    await (table as any).update({
      where: { id: targetId },
      data: updateData,
    });
    logger.info(
      `[silent] State updated for ${isTask ? "task" : "reminder"} ${targetId}`,
    );
  }
}
