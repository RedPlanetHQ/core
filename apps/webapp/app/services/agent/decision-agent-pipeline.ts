/**
 * Decision Agent Pipeline
 *
 * Trigger pipeline: takes a trigger + context, runs the butler with think enabled,
 * and optionally delivers to channel.
 *
 * Flow:
 * 1. Butler starts with trigger context + think tool
 * 2. Butler calls think (subagent) → gets ActionPlan
 * 3. Butler executes the plan (skills, integrations, tasks)
 * 4. Pipeline extracts shouldMessage from think output → delivers to channel or not
 */

import { UserTypeEnum } from "@core/types";
import {
  processInboundMessage,
  getOrCreateChannelConversation,
} from "~/services/agent/message-processor";
import {
  type DecisionContext,
  type Trigger,
} from "~/services/agent/types/decision-agent";
import { getChannel } from "~/services/channels";
import { type ChannelType } from "~/services/agent/prompts/channel-formats";
import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import { type OrchestratorTools } from "~/services/agent/orchestrator-tools";
import { upsertConversationHistory } from "~/services/conversation.server";
import { getOrCreateAsyncConversation } from "~/services/agent/context/decision-context";
import { deductCredits } from "~/trigger/utils/utils";

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
}

export interface CASEPipelineResult {
  success: boolean;
  shouldMessage: boolean;
  reasoning: string;
  error?: string;
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
  } = input;

  try {
    // =========================================================================
    // Get or create conversation for this async job
    // =========================================================================
    const conversationSource =
      trigger.type === "integration_webhook"
        ? ((trigger.data as any).integration ?? "integration")
        : "reminder";

    const conversationId = await getOrCreateAsyncConversation(
      userData.workspaceId,
      userData.userId,
      reminderId,
      conversationSource,
      reminderText,
    );

    // =========================================================================
    // Run butler with think tool enabled
    // =========================================================================
    logger.info(`[pipeline] Running butler with think for ${reminderId}`);

    const { responseText, parts } = await processInboundMessage({
      userId: userData.userId,
      workspaceId: userData.workspaceId,
      channel: trigger.channel as ChannelType,
      userMessage: `[Trigger fired] ${reminderText}`,
      conversationId,
      skipUserMessage: true,
      messageUserType: UserTypeEnum.System,
      triggerContext: {
        trigger,
        context,
        reminderText,
        userPersona,
      },
      executorTools,
    });

    // =========================================================================
    // Extract shouldMessage from think tool output
    // =========================================================================
    const thinkPart = parts.find(
      (p: any) => p.toolName === "think",
    );
    const actionPlan = thinkPart?.output;
    const shouldMessage = actionPlan?.shouldMessage ?? true;
    const reasoning = actionPlan?.reasoning ?? "No think output found";

    logger.info(`[pipeline] Decision for ${reminderId}`, {
      shouldMessage,
      reasoning,
      hasThinkOutput: !!thinkPart,
    });

    // =========================================================================
    // Deliver to channel if shouldMessage
    // =========================================================================
    if (shouldMessage) {
      if (!responseText || responseText === "I processed your request.") {
        logger.warn(`[pipeline] Butler produced empty/generic response for ${reminderId}`, {
          channel: trigger.channel,
          responseText,
        });
      }

      await deliverToChannel(
        responseText,
        trigger.channel,
        userData,
        { id: reminderId, text: reminderText },
        conversationId,
      );
    } else {
      logger.info(`[pipeline] Butler executed silently for ${reminderId}`, {
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
                reminderId,
                data: action.data,
              });
              break;
            }
            case "update_state": {
              await executeStateUpdate(action, trigger.userId, reminderId);
              break;
            }
            default:
              logger.warn(`Unknown silent action type: ${action.type}`);
          }
        } catch (error) {
          logger.error(`Failed to execute silent action: ${action.type}`, {
            reminderId,
            error,
          });
        }
      }
    }

    // Deduct credits (1 for think-only, 2 if butler also ran full execution)
    try {
      await deductCredits(
        userData.workspaceId,
        userData.userId,
        "chatMessage",
        1, // noStreamProcess already deducts 1, so just 1 more for the pipeline
      );
    } catch (error) {
      logger.warn(
        `[pipeline] Failed to deduct credits for ${reminderId}`,
        { error },
      );
    }

    logger.info(`[pipeline] Successfully processed ${reminderId}`);

    return {
      success: true,
      shouldMessage,
      reasoning,
    };
  } catch (error) {
    logger.error(`[pipeline] Failed for ${reminderId}`, { error });
    return {
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Channel Delivery
// ============================================================================

/**
 * Deliver the butler's response to the user's channel (WhatsApp, Slack, email)
 */
async function deliverToChannel(
  responseText: string,
  channel: string,
  userData: {
    userId: string;
    email: string;
    phoneNumber?: string;
    workspaceId: string;
  },
  reminder: { id: string; text: string },
  conversationId: string,
) {
  const handler = getChannel(channel);
  let replyTo: string | undefined;

  if (channel === "whatsapp") {
    replyTo = userData.phoneNumber;
  } else if (channel === "slack") {
    const slackAccount = await prisma.integrationAccount.findFirst({
      where: {
        integratedById: userData.userId,
        integrationDefinition: { slug: "slack" },
        isActive: true,
        deleted: null,
      },
      select: { accountId: true },
    });
    replyTo = slackAccount?.accountId ?? undefined;
  } else if (channel === "telegram") {
    const telegramChannel = await prisma.channel.findFirst({
      where: { workspaceId: userData.workspaceId, type: "telegram", isActive: true },
      orderBy: { isDefault: "desc" },
    });
    const config = telegramChannel?.config as Record<string, string> | undefined;
    replyTo = config?.chat_id;
    if (telegramChannel) {
      (metadata as Record<string, string>).channelId = telegramChannel.id;
    }
  } else {
    replyTo = userData.email;
  }

  if (!replyTo) {
    logger.error(`[pipeline] No delivery target for channel=${channel}, userId=${userData.userId}`, {
      reminderId: reminder.id,
      channel,
      hasPhone: !!userData.phoneNumber,
      hasEmail: !!userData.email,
    });
    return;
  }

  const metadata: Record<string, string> = {
    workspaceId: userData.workspaceId,
  };
  if (channel === "email") {
    const subjectMatch = reminder.text.match(/\*\*Subject:\*\*\s*(.+)/);
    const subject = subjectMatch
      ? subjectMatch[1].trim()
      : reminder.text.split("\n")[0].replace(/[#*_]/g, "").trim();
    metadata.subject = subject.slice(0, 120);
  }

  logger.info(`[pipeline] Sending ${channel} message`, {
    reminderId: reminder.id,
    replyTo,
    responseLength: responseText.length,
    responsePreview: responseText.slice(0, 150),
  });

  await handler.sendReply(replyTo, responseText, metadata);
  logger.info(`[pipeline] Sent ${channel} message for ${reminder.id} to ${userData.userId}`);

  // Mirror to channel conversation so user replies have context
  try {
    const channelConversationId = await getOrCreateChannelConversation(
      userData.userId,
      userData.workspaceId,
      reminder.text,
      channel,
    );
    await upsertConversationHistory(
      crypto.randomUUID(),
      [{ text: `[Reminder] ${reminder.text}`, type: "text" }],
      channelConversationId,
      UserTypeEnum.System,
      false,
    );
    await upsertConversationHistory(
      crypto.randomUUID(),
      [{ text: responseText, type: "text" }],
      channelConversationId,
      UserTypeEnum.Agent,
      false,
    );
  } catch (error) {
    logger.warn(`[pipeline] Failed to mirror to channel conversation`, {
      error,
    });
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
  defaultReminderId: string,
) {
  const data = action.data || {};
  const targetReminderId =
    (data.targetReminderId as string) || defaultReminderId;

  logger.info(`[silent] State update: ${action.description}`, {
    userId,
    targetReminderId,
  });

  const updateData: Record<string, unknown> = {};

  // Handle metadata merge
  if (data.metadata && typeof data.metadata === "object") {
    const existing = await prisma.reminder.findUnique({
      where: { id: targetReminderId },
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
    await prisma.reminder.update({
      where: { id: targetReminderId },
      data: updateData,
    });
    logger.info(`[silent] State updated for reminder ${targetReminderId}`);
  }
}
