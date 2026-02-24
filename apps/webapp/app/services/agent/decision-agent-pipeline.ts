/**
 * Decision Agent Pipeline
 *
 * Generic CASE pipeline: takes a trigger + context, runs the decision agent,
 * executes the resulting plan (message user, silent actions), and returns the result.
 *
 * This is trigger-agnostic — the caller (reminder job, webhook handler, API route)
 * is responsible for building the trigger and context before calling this.
 */

import { UserTypeEnum } from "@core/types";
import { runDecisionAgent } from "~/services/agent/decision-agent";
import { processInboundMessage } from "~/services/agent/message-processor";
import { runOrchestrator } from "~/services/agent/orchestrator";
import {
  type ActionPlan,
  type DecisionContext,
  type MessagePlan,
  type ReminderTrigger,
  type Trigger,
} from "~/services/agent/types/decision-agent";
import { getChannel } from "~/services/channels";
import { logger } from "~/services/logger.service";
import { prisma } from "~/trigger/utils/prisma";

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
 * Run the CASE decision agent pipeline.
 *
 * 1. Run CASE → ActionPlan
 * 2. Execute the plan (message user via Sol, silent actions)
 * 3. Return result
 *
 * Caller is responsible for:
 * - Building the trigger and context
 * - Updating counts (incrementUnrespondedCount, incrementOccurrenceCount)
 * - Handling scheduling/deactivation
 */
export async function runCASEPipeline(
  input: CASEPipelineInput,
): Promise<CASEPipelineResult> {
  const { trigger, context, userPersona, userData, reminderText, reminderId, timezone } = input;

  try {
    // =========================================================================
    // Step 1: Run CASE (Decision Agent)
    // =========================================================================
    logger.info(`[CASE pipeline] Running CASE for ${reminderId}`);
    const { plan, executionTimeMs: caseTimeMs } = await runDecisionAgent(
      trigger,
      context,
      userPersona,
    );

    logger.info(`[CASE pipeline] Decision for ${reminderId}`, {
      shouldMessage: plan.shouldMessage,
      reasoning: plan.reasoning,
      createReminders: plan.createReminders.length,
      silentActions: plan.silentActions.length,
      caseTimeMs,
    });

    // =========================================================================
    // Step 2: Execute the plan
    // =========================================================================
    await executePlan(plan, trigger, userData, { id: reminderId, text: reminderText }, timezone, userPersona);

    logger.info(`[CASE pipeline] Successfully processed ${reminderId}`);

    return {
      success: true,
      shouldMessage: plan.shouldMessage,
      reasoning: plan.reasoning,
    };
  } catch (error) {
    logger.error(`[CASE pipeline] Failed for ${reminderId}`, { error });
    return {
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Plan Execution
// ============================================================================

/**
 * Execute CASE's action plan
 *
 * If shouldMessage:
 *   1. Call processInboundMessage with actionPlan (Sol crafts the message)
 *   2. Send the crafted response on the channel (WhatsApp / email)
 *
 * Always: execute silent actions (log, update_state, integration_action)
 */
async function executePlan(
  plan: ActionPlan,
  trigger: Trigger,
  userData: {
    userId: string;
    email: string;
    phoneNumber?: string;
    workspaceId: string;
  },
  reminder: { id: string; text: string },
  timezone: string,
  userPersona?: string,
) {
  const { channel } = trigger;

  // =========================================================================
  // shouldMessage — run Sol with action plan injected
  // =========================================================================
  if (plan.shouldMessage && plan.message) {
    const actionPlan = buildActionPlanForAgent(plan.message, trigger);

    try {
      const { responseText } = await processInboundMessage({
        userId: userData.userId,
        workspaceId: userData.workspaceId,
        channel: channel as "whatsapp" | "email",
        userMessage: `[Reminder triggered] ${reminder.text}`,
        messageUserType: UserTypeEnum.System,
        actionPlan,
      });

      // Send on channel
      const handler = getChannel(channel);
      const replyTo = channel === "whatsapp" ? userData.phoneNumber : userData.email;
      if (replyTo) {
        const metadata: Record<string, string> = { workspaceId: userData.workspaceId };
        if (channel === "email") {
          metadata.subject = `Reminder: ${reminder.text}`;
        }
        await handler.sendReply(replyTo, responseText, metadata);
        logger.info(`Sent ${channel} message for ${reminder.id} to ${userData.userId}`);
      }
    } catch (error) {
      logger.error(`Failed to execute message for ${reminder.id}`, { error });
    }
  } else {
    logger.info(`CASE decided not to message for ${reminder.id}`, {
      reasoning: plan.reasoning,
    });
  }

  // =========================================================================
  // Execute silentActions
  // =========================================================================
  for (const action of plan.silentActions) {
    try {
      switch (action.type) {
        case "log":
          logger.info(`[CASE silent] ${action.description}`, {
            reminderId: reminder.id,
            data: action.data,
          });
          break;
        case "update_state":
          await executeStateUpdate(action, trigger.userId, reminder.id);
          break;
        case "integration_action":
          await executeIntegrationAction(
            action,
            userData.userId,
            userData.workspaceId,
            trigger.channel,
            timezone,
            userPersona,
          );
          break;
        default:
          logger.warn(`Unknown silent action type: ${action.type}`);
      }
    } catch (error) {
      logger.error(`Failed to execute silent action: ${action.type}`, {
        reminderId: reminder.id,
        error,
      });
    }
  }
}

/**
 * Build the action plan for Sol.
 * Adds askAboutKeeping context if high unresponded count (reminder triggers only).
 */
function buildActionPlanForAgent(
  message: MessagePlan,
  trigger: Trigger,
): MessagePlan {
  // askAboutKeeping only applies to reminder triggers
  if (trigger.type !== "reminder_fired" && trigger.type !== "reminder_followup") {
    return message;
  }

  const UNRESPONDED_THRESHOLD = 5;
  const data = (trigger as ReminderTrigger).data;
  const shouldAsk =
    !data.confirmedActive &&
    data.unrespondedCount >= UNRESPONDED_THRESHOLD;

  if (message.context.askAboutKeeping || shouldAsk) {
    return {
      ...message,
      context: {
        ...message.context,
        askAboutKeeping: true,
        unrespondedCount: data.unrespondedCount,
      },
    };
  }

  return message;
}

/**
 * Execute state update — updates reminder metadata in database
 */
async function executeStateUpdate(
  action: { description: string; data?: Record<string, unknown> },
  userId: string,
  defaultReminderId: string,
) {
  const data = action.data || {};
  const targetReminderId = (data.targetReminderId as string) || defaultReminderId;

  logger.info(`[CASE silent] State update: ${action.description}`, {
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
    const existingMetadata = (existing?.metadata as Record<string, unknown>) || {};
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
    logger.info(`[CASE silent] State updated for reminder ${targetReminderId}`);
  }
}

/**
 * Execute integration action via orchestrator in write mode
 */
async function executeIntegrationAction(
  action: { description: string; data?: Record<string, unknown> },
  userId: string,
  workspaceId: string,
  channel: string,
  timezone: string,
  userPersona?: string,
) {
  const data = action.data || {};
  const query = (data.query as string) || action.description;

  logger.info(`[CASE silent] Executing integration action: ${action.description}`, {
    userId,
    query,
  });

  const { stream } = await runOrchestrator(
    userId,
    workspaceId,
    query,
    "write",
    timezone,
    channel,
    undefined,
    userPersona,
  );

  // Consume the stream to completion (silent — no UI)
  const resultText = await stream.text;
  logger.info(`[CASE silent] Integration action completed`, {
    userId,
    text: resultText?.slice(0, 200),
  });
}
