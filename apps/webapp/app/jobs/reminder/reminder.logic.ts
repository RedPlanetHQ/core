/**
 * Reminder Processing Logic
 *
 * Common business logic for processing reminders, shared between
 * Trigger.dev and BullMQ implementations.
 */

import { UserTypeEnum } from "@core/types";
import { getWorkspacePersona } from "~/models/workspace.server";
import { buildReminderContext, createFollowUpTrigger, createReminderTriggerFromDb } from "~/services/agent/context/decision-context";
import { runDecisionAgent } from "~/services/agent/decision-agent";
import { processInboundMessage } from "~/services/agent/message-processor";
import { runOrchestrator } from "~/services/agent/orchestrator";
import { type ActionPlan, type MessagePlan, type ReminderTrigger } from "~/services/agent/types/decision-agent";
import { isWithinWhatsApp24hWindow } from "~/services/conversation.server";
import { sendPlainTextEmail } from "~/services/email.server";
import { logger } from "~/services/logger.service";
import { incrementOccurrenceCount, incrementUnrespondedCount } from "~/services/reminder.server";
import { sendWhatsAppMessage } from "~/services/whatsapp.server";
import { prisma } from "~/trigger/utils/prisma";

// ============================================================================
// Types
// ============================================================================

export interface ReminderJobData {
  reminderId: string;
  workspaceId: string;
  channel: "whatsapp" | "email";
}

export interface FollowUpJobData {
  parentReminderId: string;
  workspaceId: string;
  channel: "whatsapp" | "email";
  action: string;
  originalSentAt: string; // ISO timestamp
}

export interface ReminderProcessResult {
  success: boolean;
  shouldDeactivate?: boolean;
  isFollowUp?: boolean;
  error?: string;
}

// ============================================================================
// Business Logic
// ============================================================================

/**
 * Process a reminder job
 *
 * This handles:
 * 1. Checking if reminder is still active
 * 2. Updating occurrence/unresponded counts
 * 3. Scheduling next occurrence via callback
 *
 * @param data - Reminder job data
 * @param scheduleNextOccurrence - Callback to schedule the next occurrence
 * @param deactivateReminder - Callback to deactivate the reminder
 */
export async function processReminderJob(
  data: ReminderJobData,
  scheduleNextOccurrence: (reminderId: string) => Promise<boolean>,
  deactivateReminder: (reminderId: string) => Promise<void>,
): Promise<ReminderProcessResult> {
  const { reminderId, workspaceId, channel } = data;

  try {
    logger.info(
      `Processing reminder ${reminderId} for workspace ${workspaceId} on ${channel}`,
    );

    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder || !reminder.isActive) {
      logger.info(`Reminder ${reminderId} is no longer active, skipping`);
      return { success: true };
    }

    // Check if this is a follow-up reminder
    const metadata = reminder.metadata as Record<string, unknown> | null;
    const isFollowUp = metadata?.isFollowUp === true;

    if (isFollowUp) {
      // Follow-ups are one-time, deactivate after processing
      await deactivateReminder(reminderId);
      logger.info(`Processed follow-up reminder ${reminderId}`);
      return { success: true, isFollowUp: true };
    }

        // Check WhatsApp 24-hour window policy
    if (channel === "whatsapp") {
      const canSend = await isWithinWhatsApp24hWindow(workspaceId);
      if (!canSend) {
        logger.info(
          `Workspace ${workspaceId} outside 24h window - skipping reminder ${reminderId}`
        );
        // For follow-ups, just deactivate (don't reschedule)
        if (isFollowUp) {
          await deactivateReminder(reminderId);
        } else {
          await scheduleNextOccurrence(reminderId);
        }
        return { success: true };
      }
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: {include: {user: true}} },
    });

    const user = workspace?.UserWorkspace?.[0]?.user;
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const timezone = userMetadata?.timezone as string || "UTC";

    // =========================================================================
    // Step 1: Create trigger from reminder
    // =========================================================================
    // For follow-ups, use createFollowUpTrigger instead
    const trigger = isFollowUp
      ? createFollowUpTrigger({
          id: reminder.id,
          userId: user?.id as string,
          workspaceId,
          text: reminder.text,
          channel: reminder.channel,
          unrespondedCount: reminder.unrespondedCount,
          confirmedActive: reminder.confirmedActive,
          occurrenceCount: reminder.occurrenceCount,
        })
      : createReminderTriggerFromDb({
          id: reminder.id,
          userId: user?.id as string,
          workspaceId,
          text: reminder.text,
          channel: reminder.channel,
          unrespondedCount: reminder.unrespondedCount,
          confirmedActive: reminder.confirmedActive,
          occurrenceCount: reminder.occurrenceCount,
        });

    // =========================================================================
    // Step 2: Initialize MCP client for CASE (enables gather_context tool)
    // =========================================================================
    const [context, userPersona] = await Promise.all([
      buildReminderContext(trigger, timezone),
      getWorkspacePersona(workspaceId)
    ]);


    // =========================================================================
    // Step 3: Run CASE (Decision Agent) with orchestrator access
    // =========================================================================
    logger.info(`Running CASE for reminder ${reminderId}`);
    const { plan, executionTimeMs: caseTimeMs } = await runDecisionAgent(
      trigger,
      context,
      userPersona?.content,
    );

    logger.info(`CASE decision for ${reminderId}`, {
      shouldMessage: plan.shouldMessage,
      reasoning: plan.reasoning,
      createReminders: plan.createReminders.length,
      silentActions: plan.silentActions.length,
      caseTimeMs,
    });


    // =========================================================================
    // Step 4: Execute the plan
    // =========================================================================
    await executePlan(plan, trigger, {
      userId: user?.id as string,
      email: user?.email as string,
      phoneNumber: user?.phoneNumber ?? undefined,
      workspaceId,
    }, reminder, timezone, userPersona?.content);


    // =========================================================================
    // Step 5: Update counts and schedule next occurrence
    // =========================================================================
    // For follow-ups: just deactivate after processing (one-time)
    // For regular reminders: update counts and schedule next occurrence
    if (isFollowUp) {
      // Follow-ups are one-time, deactivate after processing
      await deactivateReminder(reminderId);
      logger.info(`Successfully processed follow-up reminder ${reminderId}`);
    } else {
      // incrementUnrespondedCount also updates lastSentAt
      if (plan.shouldMessage) {
        await incrementUnrespondedCount(reminderId);
      }

      const { shouldDeactivate } = await incrementOccurrenceCount(reminderId);
      if (shouldDeactivate) {
        logger.info(`Reminder ${reminderId} has been auto-deactivated`);
        return {success: true};
      }

      await scheduleNextOccurrence(reminderId);
      logger.info(`Successfully processed reminder ${reminderId}`);
    }

    // Update unresponded count
    await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        unrespondedCount: { increment: 1 },
        lastSentAt: new Date(),
      },
    });

    // Increment occurrence count and check for auto-deactivation
    const updatedReminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: { occurrenceCount: { increment: 1 } },
    });

    const shouldDeactivate = checkShouldDeactivate(updatedReminder);

    if (shouldDeactivate) {
      await deactivateReminder(reminderId);
      logger.info(`Reminder ${reminderId} has been auto-deactivated`);
      return { success: true, shouldDeactivate: true };
    }

    // Schedule next occurrence
    await scheduleNextOccurrence(reminderId);
    logger.info(`Successfully processed reminder ${reminderId}`);

    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process reminder ${reminderId} for workspace ${workspaceId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute CASE's action plan
 *
 * If shouldMessage:
 *   1. Call processInboundMessage with actionPlan (core brain crafts the message)
 *   2. Send the crafted response on the channel (WhatsApp / email)
 *   (conversation saving + memory ingestion handled by processInboundMessage)
 *
 * Always: execute silent actions (log, update_state)
 */
async function executePlan(
  plan: ActionPlan,
  trigger: ReminderTrigger,
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
  // shouldMessage — run core brain with action plan injected
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
      if (channel === "whatsapp" && userData.phoneNumber) {
        await sendWhatsAppMessage(userData.phoneNumber, responseText);
        logger.info(`Sent WhatsApp reminder ${reminder.id} to ${userData.userId}`);
      } else if (channel === "email" && userData.email) {
        await sendPlainTextEmail({
          to: userData.email,
          subject: `Reminder: ${reminder.text}`,
          text: responseText,
        });
        logger.info(`Sent email reminder ${reminder.id} to ${userData.userId}`);
      }
    } catch (error) {
      logger.error(`Failed to execute reminder message for ${reminder.id}`, { error });
    }
  } else {
    logger.info(`CASE decided not to message for reminder ${reminder.id}`, {
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
 * Build the action plan for the core brain agent.
 * Adds askAboutKeeping context if high unresponded count.
 */
function buildActionPlanForAgent(
  message: MessagePlan,
  trigger: ReminderTrigger,
): MessagePlan {
  const UNRESPONDED_THRESHOLD = 5;
  const shouldAsk =
    !trigger.data.confirmedActive &&
    trigger.data.unrespondedCount >= UNRESPONDED_THRESHOLD;

  if (message.context.askAboutKeeping || shouldAsk) {
    return {
      ...message,
      context: {
        ...message.context,
        askAboutKeeping: true,
        unrespondedCount: trigger.data.unrespondedCount,
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
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  const resultText = await stream.text;
  logger.info(`[CASE silent] Integration action completed`, {
    userId,
    text: resultText?.slice(0, 200),
  });
}


/**
 * Process a follow-up job
 */
export async function processFollowUpJob(
  data: FollowUpJobData,
): Promise<ReminderProcessResult> {
  const { parentReminderId, workspaceId, channel, action } = data;

  try {
    logger.info(`Processing follow-up for reminder ${parentReminderId}`, {
      workspaceId,
      channel,
      action,
    });

    const reminder = await prisma.reminder.findUnique({
      where: { id: parentReminderId },
    });

    if (!reminder || !reminder.isActive) {
      logger.info(
        `Parent reminder ${parentReminderId} is no longer active, skipping follow-up`,
      );
      return { success: true };
    }

    // For now, just log. When CASE is wired up, this will run through decision agent.
    logger.info(`Follow-up processed for reminder ${parentReminderId}`);

    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process follow-up for reminder ${parentReminderId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if reminder should be auto-deactivated
 */
function checkShouldDeactivate(reminder: {
  occurrenceCount: number;
  maxOccurrences: number | null;
  endDate: Date | null;
}): boolean {
  if (
    reminder.maxOccurrences !== null &&
    reminder.maxOccurrences > 0 &&
    reminder.occurrenceCount >= reminder.maxOccurrences
  ) {
    return true;
  }

  if (reminder.endDate !== null && new Date() >= reminder.endDate) {
    return true;
  }

  return false;
}

/**
 * Parse relative time strings like "in 30 minutes", "in 1 hour"
 */
export function parseRelativeTime(scheduledFor: Date | string): Date | null {
  if (scheduledFor instanceof Date) {
    return scheduledFor;
  }

  const isoDate = new Date(scheduledFor);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const relativeMatch = scheduledFor.match(
    /in\s+(\d+)\s*(min(?:ute)?s?|hour?s?|h|m)/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();
    if (unit.startsWith("h")) {
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    } else {
      return new Date(now.getTime() + amount * 60 * 1000);
    }
  }

  logger.warn(`Could not parse scheduledFor: ${scheduledFor}`);
  return null;
}
