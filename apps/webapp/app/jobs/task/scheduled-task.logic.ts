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
  deactivateScheduledTask,
} from "~/services/task.server";
import { prisma } from "~/db.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import { getPageContentAsHtml } from "~/services/hocuspocus/content.server";

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
 * Process a scheduled task job.
 *
 * Flow:
 * 1. Load task from DB, check preconditions (active, etc.)
 * 2. Build trigger + context
 * 3. Delegate to runCASEPipeline
 * 4. Update counts (unresponded, occurrence)
 * 5. Schedule next occurrence or deactivate
 */
export async function processScheduledTask(
  data: ScheduledTaskPayload,
): Promise<ScheduledTaskProcessResult> {
  const { taskId, workspaceId } = data;

  try {
    logger.info(
      `Processing scheduled task ${taskId} for workspace ${workspaceId}`,
    );

    // =========================================================================
    // Load task and check preconditions
    // =========================================================================
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || !task.isActive) {
      logger.info(`Task ${taskId} is no longer active, skipping`);
      return { success: true };
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
    const taskText = (task.pageId ? await getPageContentAsHtml(task.pageId) : null) || task.title;

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
    });

    const [context, userPersona] = await Promise.all([
      buildScheduledTaskContext(trigger, timezone),
      getWorkspacePersona(workspaceId),
    ]);

    // =========================================================================
    // Run CASE pipeline
    // =========================================================================
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
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // =========================================================================
    // Update counts and handle scheduling
    // =========================================================================
    if (result.shouldMessage) {
      await incrementTaskUnrespondedCount(taskId);
    }

    const { shouldDeactivate } = await incrementTaskOccurrenceCount(taskId);
    if (shouldDeactivate) {
      logger.info(`Task ${taskId} has been auto-deactivated`);
      return { success: true, shouldDeactivate: true };
    }

    // Re-check task still exists before scheduling next (may have been deleted mid-execution)
    const stillExists = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, isActive: true },
    });
    if (!stillExists || !stillExists.isActive) {
      logger.info(`Task ${taskId} was deleted/deactivated during execution, skipping next schedule`);
      return { success: true };
    }

    await scheduleNextTaskOccurrence(taskId);
    logger.info(`Successfully processed scheduled task ${taskId}`);

    return { success: true };
  } catch (error) {
    logger.error(
      `Failed to process scheduled task ${taskId} for workspace ${workspaceId}`,
      { error },
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
