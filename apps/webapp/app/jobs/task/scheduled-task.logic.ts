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
  deleteTask,
  incrementTaskOccurrenceCount,
  incrementTaskUnrespondedCount,
  scheduleNextTaskOccurrence,
  updateTaskConversationIds,
} from "~/services/task.server";
import { prisma } from "~/db.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";
import { removeTaskItemFromPages } from "~/services/hocuspocus/page-outlinks.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
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
 * Process a scheduled-task wake-up. In the execute-first lifecycle the
 * dispatch is purely status-driven (phase metadata controls prompt
 * rendering, not wake-up routing). Wake-ups serve three purposes:
 *
 * 1. **Buffer expiry** — task is Ready with no schedule. The 2-minute
 *    editing buffer is over; hand off to the task runner, which flips
 *    status to Working and invokes the agent (execute mind by default,
 *    or plan mind if `metadata.phase === "prep"`).
 * 2. **Normal fire** — task is Ready with a schedule. The scheduled /
 *    recurring time arrived; execute via the CASE pipeline.
 * 3. **Fire-override** — task is Todo or Waiting AND has a schedule. The
 *    schedule fires while the task is still parked or blocked; execute
 *    with whatever info is available (flipping status to Working).
 *
 * Stuck-state recovery branches catch Working + Review on recurring
 * tasks (previous occurrence crashed or never looped back).
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

    // Execute-first lifecycle: phase is agent-driven, not status-driven.
    // The buffer wake-up only cares about status + schedule.

    // 2-minute editing buffer expired on a Ready task (no schedule). Hand
    // off to the task runner; the agent picks up in execute mind (or plan
    // mind if it has since self-promoted). Todo is the backlog state and
    // does not auto-buffer — it has to be promoted to Ready first.
    const isBufferExpiry = task.status === "Ready" && !task.schedule;

    // Scheduled / recurring task fired while still Todo or Waiting.
    // The schedule beats the lifecycle — execute with whatever info is
    // available; the conversation history captures any pre-fire prep.
    const isScheduledFireDuringWorkup =
      (task.status === "Todo" || task.status === "Waiting") && !!task.schedule;

    const isNormalFire = task.status === "Ready" && !!task.schedule;

    // Recovery branches for recurring tasks. Without these the task gets
    // stuck and every future wake-up no-ops, silently killing the recurrence.
    //
    // Working: previous occurrence's pipeline crashed mid-execution (machine
    //   kill, OOM, deploy) before scheduleNextTaskOccurrence ran.
    // Review (recurring only): previous occurrence ended in Review and the
    //   user/system never moved it back to Ready before the next scheduled
    //   time arrived. Recurring tasks should auto-loop.
    const isStuckWorking = task.status === "Working";
    const isStuckReview = task.status === "Review" && !!task.schedule;

    if (isBufferExpiry) {
      return await startExecutionFromBuffer(task);
    }
    if (isScheduledFireDuringWorkup) {
      return await executeFireOverride(data, task);
    }
    if (isNormalFire || isStuckWorking || isStuckReview) {
      if (isStuckWorking) {
        logger.warn(
          `Task ${taskId} wake-up fired while still Working — assuming previous occurrence crashed, recovering`,
        );
      }
      if (isStuckReview) {
        logger.warn(
          `Task ${taskId} wake-up fired while in Review — recurring task auto-recovering for next occurrence`,
        );
      }
      return await runExecutionPipeline(data, task);
    }

    logger.info(
      `Task ${taskId} wake-up fired in unexpected state (status=${task.status}) — no-op`,
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
 * Buffer expiry: the 2-minute editing window is up. Clear nextRunAt and
 * hand off to the task runner. The agent picks up in execute mind by
 * default; if a prior turn called enter_plan_mode (metadata.phase = "prep")
 * the task_planning block renders instead. Status stays as it was —
 * Todo or Ready — and the runner flips it to Working when execution starts.
 *
 * Parity with the client-side delete-on-removal in scratchpad-task-item.tsx:
 * if a scratchpad-created task (`source === "daily"`) sits in the editor
 * for the full 2 minutes without ever getting a title or description, drop
 * it and pull its node out of any pages that still reference it.
 */
async function startExecutionFromBuffer(
  task: Task,
): Promise<ScheduledTaskProcessResult> {
  if (task.source === "daily" && (await isTaskEmpty(task))) {
    logger.info(
      `Auto-deleting empty scratchpad task ${task.id} at buffer expiry`,
    );
    await removeTaskItemFromPages(task.id);
    await deleteTask(task.id, task.workspaceId);
    return { success: true };
  }

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
 * Mirrors the client-side empty check in scratchpad-task-item.tsx: a task
 * is "empty" if its title was never set past the placeholder and its page
 * has no description content.
 */
async function isTaskEmpty(task: Task): Promise<boolean> {
  const trimmedTitle = task.title?.trim() ?? "";
  const isUntitled = trimmedTitle === "" || trimmedTitle === "Untitled task";
  if (!isUntitled) return false;

  if (!task.pageId) return true;
  const html = await getPageContentAsHtml(task.pageId);
  if (!html) return true;
  // generateHTML wraps even an empty Tiptap doc in a single `<p></p>`;
  // strip tags+whitespace and treat that as no content.
  const stripped = html.replace(/<[^>]*>/g, "").trim();
  return stripped === "";
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
    data: { status: "Working" },
  });
  return await runExecutionPipeline(data, updated);
}

/**
 * Run the CASE execution pipeline. Used by both the normal-fire and
 * fire-override branches. Handles conversation tracking, occurrence counts,
 * and scheduling the next recurrence.
 *
 * Pipeline failures (returned `{success:false}` or thrown) must NOT skip
 * rescheduling for recurring tasks — a transient model/credit/network error
 * on one occurrence should not silently kill the whole recurrence.
 * scheduleNextTaskOccurrence is idempotent for non-recurring tasks
 * (short-circuits when `task.schedule` is null) so it's always safe to call.
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

  // runCASEPipeline runs its own pre-flight credit check and short-circuits
  // with error: "insufficient_credits" for non-BYOK workspaces with empty
  // balances. Recurring tasks survive credit outages via the failure path
  // below (next occurrence is rescheduled); one-time tasks no-op.
  let result: CASEPipelineResult;
  try {
    result = await runCASEPipeline({
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
  } catch (error) {
    logger.error(`[scheduled-task] Pipeline threw for ${taskId}`, { error });
    result = {
      success: false,
      shouldMessage: false,
      reasoning: "Pipeline error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  if (result.success && result.conversationId) {
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

  if (result.success && result.shouldMessage) {
    await incrementTaskUnrespondedCount(taskId);
  }

  const { shouldDeactivate } = await incrementTaskOccurrenceCount(taskId);
  if (shouldDeactivate) {
    logger.info(`Task ${taskId} has been auto-deactivated`);
    return result.success
      ? { success: true, shouldDeactivate: true }
      : { success: false, shouldDeactivate: true, error: result.error };
  }

  const stillExists = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, isActive: true },
  });
  if (!stillExists || !stillExists.isActive) {
    logger.info(
      `Task ${taskId} was deleted/deactivated during execution, skipping next schedule`,
    );
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  await scheduleNextTaskOccurrence(taskId);

  if (result.success) {
    logger.info(`Successfully processed scheduled task ${taskId}`);
    return { success: true };
  }
  logger.warn(
    `Scheduled task ${taskId} pipeline failed but next occurrence was scheduled`,
    { error: result.error },
  );
  return { success: false, error: result.error };
}
