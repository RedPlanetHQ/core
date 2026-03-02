/**
 * Background Task Processing Logic
 *
 * Runs the orchestrator with the user's intent and a send_channel_message tool
 * that allows the agent to send messages directly to the callback channel.
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
import {
  runOrchestrator,
  type BackgroundTaskContext,
} from "~/services/agent/orchestrator";
import { logger } from "~/services/logger.service";
import { getOrCreatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { CoreClient } from "@redplanethq/sdk";
import { HttpOrchestratorTools } from "~/services/agent/orchestrator-tools.http";

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

    // Get user info (timezone, personality, name)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true, name: true },
    });
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const timezone = (userMetadata?.timezone as string) || "UTC";
    const personalityType = (userMetadata?.personality as "tars" | "butler" | "warm") || "tars";
    const userName = user?.name || "User";

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

    // Get the task to retrieve callback context
    const task = await getBackgroundTaskById(taskId);
    if (!task) {
      throw new Error(`Background task ${taskId} not found`);
    }

    // Build background task context for the orchestrator
    const backgroundTaskContext: BackgroundTaskContext = {
      taskId,
      callbackChannel: task.callbackChannel as BackgroundTaskContext["callbackChannel"],
      callbackConversationId: task.callbackConversationId ?? undefined,
      callbackMetadata: task.callbackMetadata as Record<string, unknown> | undefined,
      personalityType,
      userName,
    };

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
        backgroundTaskContext,
      );

      // Consume stream and get result
      const result = await stream.text;

      clearTimeout(timeoutId);

      // Mark as completed
      await markBackgroundTaskCompleted(taskId, result || "Task completed");

      logger.info(`Background task ${taskId} completed`);

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

    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }
}
