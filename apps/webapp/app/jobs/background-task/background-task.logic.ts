/**
 * Background Task Processing Logic
 *
 * Runs the existing orchestrator with the user's intent, plus special tools:
 * - sleep: Durable wait between periodic checks
 * - complete_task: Signal task completion
 *
 * On completion/failure/timeout, triggers decision agent for user notification.
 */

import { env } from "~/env.server";
import { prisma } from "~/db.server";
import {
  markBackgroundTaskStarted,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskTimeout,
  getBackgroundTaskById,
} from "~/services/background-task.server";
import { getWorkspacePersona } from "~/models/workspace.server";
import { runOrchestrator } from "~/services/agent/orchestrator";
import { runCASEPipeline } from "~/services/agent/decision-agent-pipeline";
import {
  buildBackgroundTaskContext,
  createBackgroundTaskTrigger,
} from "./background-task-context";
import { logger } from "~/services/logger.service";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";
import type { OrchestratorTools } from "~/services/agent/orchestrator-tools";

// ============================================================================
// Types
// ============================================================================

export interface BackgroundTaskPayload {
  taskId: string;
  workspaceId: string;
  userId: string;
  intent: string;
  timeoutMs: number;
}

export interface BackgroundTaskResult {
  success: boolean;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: string;
  error?: string;
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process a background task using the existing orchestrator
 */
export async function processBackgroundTask(
  payload: BackgroundTaskPayload,
): Promise<BackgroundTaskResult> {
  const { taskId, workspaceId, userId, intent, timeoutMs } = payload;

  try {
    logger.info(`Processing background task ${taskId}`, {
      workspaceId,
      intent: intent.substring(0, 100),
    });

    // Mark task as started
    await markBackgroundTaskStarted(taskId);

    // Get workspace/user info
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { UserWorkspace: { include: { user: true } } },
    });

    const user = workspace?.UserWorkspace?.[0]?.user;
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (userMetadata?.timezone as string) || "UTC";

    // Create HTTP tools for orchestrator
    const { token } = await getOrCreatePersonalAccessToken({
      name: "background-task-internal",
      userId,
      workspaceId,
      returnDecrypted: true,
    });
    const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
    const executorTools = new HttpOrchestratorTools(client);

    // Get user persona
    const userPersona = await getWorkspacePersona(workspaceId);

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // Run the orchestrator with the intent
      const { stream } = await runOrchestrator(
        userId,
        workspaceId,
        intent,
        "write", // Use write mode to allow actions
        timezone,
        "background-task",
        abortController.signal,
        userPersona?.content,
        undefined, // No skills for background tasks
        executorTools,
      );

      // Consume stream and get result
      const result = await stream.text;

      clearTimeout(timeoutId);

      // Mark as completed
      await markBackgroundTaskCompleted(taskId, result || "Task completed");

      // Trigger callback to notify user
      await triggerCallback(
        taskId,
        "completed",
        workspaceId,
        userId,
        timezone,
        executorTools,
        user,
        result || "Task completed",
      );

      return {
        success: true,
        status: "completed",
        result: result || "Task completed",
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // Check if aborted due to timeout
      if (abortController.signal.aborted) {
        logger.info(`Background task ${taskId} timed out`);
        await markBackgroundTaskTimeout(taskId);

        await triggerCallback(
          taskId,
          "timeout",
          workspaceId,
          userId,
          timezone,
          executorTools,
          user,
          "Task timed out before completion",
        );

        return {
          success: false,
          status: "timeout",
          error: "Task exceeded timeout limit",
        };
      }

      throw error;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Background task ${taskId} failed`, { error });

    // Check if task is cancelled
    const task = await getBackgroundTaskById(taskId);
    if (task?.status === "cancelled") {
      return {
        success: false,
        status: "cancelled",
        error: "Task was cancelled",
      };
    }

    await markBackgroundTaskFailed(taskId, errorMsg);

    // Try to get user info for callback
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { UserWorkspace: { include: { user: true } } },
      });
      const user = workspace?.UserWorkspace?.[0]?.user;
      const userMetadata = user?.metadata as Record<string, unknown> | null;
      const timezone = (userMetadata?.timezone as string) || "UTC";

      const { token } = await getOrCreatePersonalAccessToken({
        name: "background-task-internal",
        userId,
        workspaceId,
        returnDecrypted: true,
      });
      const client = new CoreClient({ baseUrl: env.APP_ORIGIN, token: token! });
      const executorTools = new HttpOrchestratorTools(client);

      await triggerCallback(
        taskId,
        "failed",
        workspaceId,
        userId,
        timezone,
        executorTools,
        user,
        undefined,
        errorMsg,
      );
    } catch (callbackError) {
      logger.error(`Failed to send failure callback for task ${taskId}`, {
        callbackError,
      });
    }

    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }
}

// ============================================================================
// Callback to Decision Agent
// ============================================================================

/**
 * Trigger decision agent to notify user about task completion
 */
async function triggerCallback(
  taskId: string,
  status: "completed" | "failed" | "timeout",
  workspaceId: string,
  userId: string,
  timezone: string,
  executorTools: OrchestratorTools,
  user: any,
  result?: string,
  error?: string,
): Promise<void> {
  try {
    const task = await getBackgroundTaskById(taskId);
    if (!task) {
      logger.error(`Cannot trigger callback: task ${taskId} not found`);
      return;
    }

    // Build trigger and context for decision agent
    const trigger = createBackgroundTaskTrigger(task, status, result, error);
    const context = await buildBackgroundTaskContext(trigger, timezone);
    const userPersona = await getWorkspacePersona(workspaceId);

    // Run CASE pipeline to notify user
    await runCASEPipeline({
      trigger,
      context,
      userPersona: userPersona?.content,
      userData: {
        userId,
        email: user?.email || "",
        phoneNumber: user?.phoneNumber ?? undefined,
        workspaceId,
      },
      reminderText: `Background task ${status}: ${task.intent}`,
      reminderId: taskId, // Use taskId for logging
      timezone,
      executorTools,
    });

    logger.info(`Background task ${taskId} callback sent via decision agent`);
  } catch (error) {
    logger.error(`Failed to trigger callback for task ${taskId}`, { error });
  }
}
