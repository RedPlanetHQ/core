/**
 * Reminder Processing Logic
 *
 * Common business logic for processing reminders, shared between
 * Trigger.dev and BullMQ implementations.
 *
 * The generic CASE pipeline lives in `runCASEPipeline()` (decision-agent-pipeline.ts).
 * This file handles reminder-specific logic: loading from DB, precondition checks,
 * building the trigger/context, then delegating to the pipeline, and finally
 * handling scheduling/deactivation.
 */

import { env } from "~/env.server";
import { getWorkspacePersona } from "~/models/workspace.server";
import {
  buildReminderContext,
  createReminderTriggerFromDb,
} from "~/services/agent/context/decision-context";
import type { CASEPipelineResult } from "~/services/agent/decision-agent-pipeline";
import { logger } from "~/services/logger.service";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import {
  incrementOccurrenceCount,
  incrementUnrespondedCount,
} from "~/services/reminder.server";
import type { MessageChannel } from "~/services/agent/types";
import { prisma } from "~/trigger/utils/prisma";
import axios from "axios";

// ============================================================================
// Types
// ============================================================================

export interface ReminderJobData {
  reminderId: string;
  workspaceId: string;
  channel: MessageChannel;
}

export interface FollowUpJobData {
  parentReminderId: string;
  workspaceId: string;
  channel: MessageChannel;
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
 * Reminder-specific flow:
 * 1. Load reminder from DB, check preconditions (active, follow-up, WhatsApp window)
 * 2. Build trigger + context
 * 3. Delegate to runCASEPipeline (run CASE → execute plan)
 * 4. Update counts (incrementUnrespondedCount, incrementOccurrenceCount)
 * 5. Handle scheduling via callbacks (deactivate or schedule next)
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

    // =========================================================================
    // Load reminder and check preconditions
    // =========================================================================
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder || !reminder.isActive) {
      logger.info(`Reminder ${reminderId} is no longer active, skipping`);
      return { success: true };
    }

    const metadata = reminder.metadata as Record<string, unknown> | null;
    const isFollowUp = metadata?.isFollowUp === true;

    if (isFollowUp) {
      await deactivateReminder(reminderId);
      logger.info(`Processed follow-up reminder ${reminderId}`);
      return { success: true, isFollowUp: true };
    }

    // =========================================================================
    // Load workspace/user
    // =========================================================================
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: { include: { user: true } } },
    });

    const user = workspace?.UserWorkspace?.[0]?.user;
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (userMetadata?.timezone as string) || "UTC";

    // =========================================================================
    // Build trigger + context + persona (parallel)
    // =========================================================================
    const trigger = createReminderTriggerFromDb({
      id: reminder.id,
      userId: user?.id as string,
      workspaceId,
      text: reminder.text,
      channel: reminder.channel,
      unrespondedCount: reminder.unrespondedCount,
      confirmedActive: reminder.confirmedActive,
      occurrenceCount: reminder.occurrenceCount,
    });

    const [context, userPersona] = await Promise.all([
      buildReminderContext(trigger, timezone),
      getWorkspacePersona(workspaceId),
    ]);

    // =========================================================================
    // Call decision agent API (run CASE → execute plan)
    // =========================================================================
    const { token } = await getOrCreatePersonalAccessToken({
      name: "case-internal",
      userId: user?.id as string,
      workspaceId,
      returnDecrypted: true,
    });

    const response = await axios.post(
      `${env.APP_ORIGIN}/api/v1/decision-agent`,
      {
        trigger,
        context,
        userPersona: userPersona?.content,
        userData: {
          userId: user?.id as string,
          email: user?.email as string,
          phoneNumber: user?.phoneNumber ?? undefined,
          workspaceId,
        },
        reminderText: reminder.text,
        reminderId: reminder.id,
        timezone,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 600000,
      },
    );

    const result: CASEPipelineResult = await response.data;

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // =========================================================================
    // Update counts and handle scheduling
    // =========================================================================
    if (result.shouldMessage) {
      await incrementUnrespondedCount(reminderId);
    }

    const { shouldDeactivate } = await incrementOccurrenceCount(reminderId);
    if (shouldDeactivate) {
      logger.info(`Reminder ${reminderId} has been auto-deactivated`);
      return { success: true, shouldDeactivate: true };
    }

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
