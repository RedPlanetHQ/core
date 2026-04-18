/**
 * Scheduled Task Processing Logic
 *
 * Handles execution of scheduled/recurring tasks — the unified replacement
 * for reminder.logic.ts. Loads task from DB, builds trigger/context,
 * delegates to runCASEPipeline, and handles scheduling/deactivation.
 */

import { env } from "~/env.server";
import { getWorkspacePersona } from "~/models/workspace.server";
import {
  buildScheduledTaskContext,
  createTaskTriggerFromDb,
} from "~/services/agent/context/decision-context";
import {
  runCASEPipeline,
  type CASEPipelineResult,
} from "~/services/agent/decision-agent-pipeline";
import { logger } from "~/services/logger.service";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import {
  incrementTaskOccurrenceCount,
  incrementTaskUnrespondedCount,
  scheduleNextTaskOccurrence,
  updateTaskConversationIds,
} from "~/services/task.server";
import { prisma } from "~/db.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import {
  getTaskPhase,
  setTaskPhaseInMetadata,
} from "~/services/task.phase";
import type { Task } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

export interface ScheduledTaskPayload {
  taskId: string;
  workspaceId: string;
  userId: string;
  channel: string;
}

export interface ScheduledTaskProcessResult {
  success: boolean;
  shouldDeactivate?: boolean;
  error?: string;
}

// ============================================================================
// Business Logic
// ============================================================================

/**
 * Process a scheduled-task wake-up. After the two-phase lifecycle refactor,
 * wake-ups serve three distinct purposes and we branch on `(status, phase)`:
 *
 * 1. **Buffer expiry** — task is Todo + prep with no recurring schedule. The
 *    2-minute edit buffer is over; hand the task off to the normal task
 *    runner so butler can start prep.
 * 2. **Normal fire** — task is Ready + execute. The scheduled/recurring time
 *    arrived; execute via the CASE pipeline.
 * 3. **Fire-override** — task is Todo/Waiting + prep AND has a recurring
 *    schedule (or was scheduled). The schedule fires before prep completed;
 *    execute with whatever info is available (flipping status to Working).
 *
 * Any other state is a stale wake-up and we no-op.
 */
export async function processScheduledTask(
  data: ScheduledTaskPayload,
): Promise<ScheduledTaskProcessResult> {
  const { taskId, workspaceId } = data;

  try {
    logger.info(
      `Processing scheduled-task wake-up ${taskId} for workspace ${workspaceId}`,
    );

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || !task.isActive) {
      logger.info(`Task ${taskId} is no longer active, no-op`);
      return { success: true };
    }

    // Stale wake-up: DB nextRunAt has moved past the intended fire time (user
    // rescheduled later or cleared it). Whoever moved it will have enqueued a
    // fresh wake-up.
    if (!task.nextRunAt) {
      logger.info(`Task ${taskId} has no nextRunAt, wake-up is stale — no-op`);
      return { success: true };
    }
    if (task.nextRunAt.getTime() > Date.now() + 1000) {
      logger.info(
        `Task ${taskId} nextRunAt is in the future (${task.nextRunAt.toISOString()}), wake-up is stale — no-op`,
      );
      return { success: true };
    }

    const phase = getTaskPhase(task);

    const isBufferExpiry =
      task.status === "Todo" && phase === "prep" && !task.schedule;

    const isScheduledFireDuringPrep =
      (task.status === "Todo" || task.status === "Waiting") &&
      phase === "prep" &&
      !!task.schedule;

    const isNormalFire = task.status === "Ready" && phase === "execute";

    if (isBufferExpiry) {
      return await startPrepFromBuffer(task);
    }
    if (isScheduledFireDuringPrep) {
      return await executeFireOverride(data, task);
    }
    if (isNormalFire) {
      return await runExecutionPipeline(data, task);
    }

    logger.info(
      `Task ${taskId} wake-up fired in unexpected state (status=${task.status}, phase=${phase}) — no-op`,
    );
    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process scheduled-task wake-up for ${taskId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Branch implementations
// ============================================================================

/**
 * Buffer-expiry branch: the 2-minute Todo window is up. Clear nextRunAt and
 * hand off to the normal task runner, which runs the agent in prep mode
 * (driven by phase=prep in context.ts).
 */
async function startPrepFromBuffer(
  task: Task,
): Promise<ScheduledTaskProcessResult> {
  await prisma.task.update({
    where: { id: task.id },
    data: { nextRunAt: null },
  });

  await enqueueTask({
    taskId: task.id,
    workspaceId: task.workspaceId,
    userId: task.userId,
  });

  return { success: true };
}

/**
 * Fire-override branch: the scheduled/recurring time arrived while the task
 * was still in Phase 1. Flip to Working + execute and run the execution
 * pipeline. Any prep conversation already attached stays in conversationIds
 * for history but will not receive further messages — execution starts in a
 * fresh conversation (forceNewConversation: true).
 */
async function executeFireOverride(
  data: ScheduledTaskPayload,
  task: Task,
): Promise<ScheduledTaskProcessResult> {
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      status: "Working",
      metadata: setTaskPhaseInMetadata(task.metadata, "execute"),
    },
  });
  return await runExecutionPipeline(data, updated);
}

/**
 * Run the CASE execution pipeline. Used by both the normal-fire and
 * fire-override branches. Handles conversation tracking, occurrence counts,
 * and scheduling the next recurrence.
 */
async function runExecutionPipeline(
  data: ScheduledTaskPayload,
  task: Task,
): Promise<ScheduledTaskProcessResult> {
  const { workspaceId, taskId } = data;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { UserWorkspace: { include: { user: true } } },
  });

  const user = workspace?.UserWorkspace?.[0]?.user;
  const userMetadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (userMetadata?.timezone as string) || "UTC";

  const taskText =
    (task.pageId ? await getPageContentAsHtml(task.pageId) : null) || task.title;

  const trigger = createTaskTriggerFromDb({
    id: task.id,
    userId: user?.id as string,
    workspaceId,
    title: task.title,
    description: taskText,
    channel: task.channel ?? "email",
    channelId: task.channelId,
    unrespondedCount: task.unrespondedCount,
    confirmedActive: task.confirmedActive,
    occurrenceCount: task.occurrenceCount,
    metadata: task.metadata as Record<string, unknown> | null,
    schedule: task.schedule,
  });

  const [context, userPersona] = await Promise.all([
    buildScheduledTaskContext(trigger, timezone),
    getWorkspacePersona(workspaceId),
  ]);

  const { token } = await getOrCreatePersonalAccessToken({
    name: "case-internal",
    userId: user?.id as string,
    workspaceId,
    returnDecrypted: true,
  });

  const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
  const executorTools = new HttpOrchestratorTools(client);

  const result: CASEPipelineResult = await runCASEPipeline({
    trigger,
    context,
    userPersona: userPersona?.content,
    userData: {
      userId: user?.id as string,
      email: user?.email as string,
      phoneNumber: user?.phoneNumber ?? undefined,
      workspaceId,
    },
    reminderText: taskText,
    reminderId: task.id,
    taskId: task.id,
    taskText,
    timezone,
    executorTools,
    forceNewConversation: true,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (result.conversationId) {
    try {
      await updateTaskConversationIds(taskId, [
        ...(task.conversationIds ?? []),
        result.conversationId,
      ]);
    } catch (error) {
      logger.warn(
        `Failed to update conversationIds for task ${taskId}; conversation ${result.conversationId} was created but will not appear in task history`,
        { error },
      );
    }
  }

  if (result.shouldMessage) {
    await incrementTaskUnrespondedCount(taskId);
  }

  const { shouldDeactivate } = await incrementTaskOccurrenceCount(taskId);
  if (shouldDeactivate) {
    logger.info(`Task ${taskId} has been auto-deactivated`);
    return { success: true, shouldDeactivate: true };
  }

  const stillExists = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, isActive: true },
  });
  if (!stillExists || !stillExists.isActive) {
    logger.info(
      `Task ${taskId} was deleted/deactivated during execution, skipping next schedule`,
    );
    return { success: true };
  }

  await scheduleNextTaskOccurrence(taskId);
  logger.info(`Successfully processed scheduled task ${taskId}`);

  return { success: true };
}
