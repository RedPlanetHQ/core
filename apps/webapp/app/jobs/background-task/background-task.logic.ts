/**
 * Background Task Processing Logic
 *
 * Runs the task intent through the same channel pipeline as handleChannelMessage,
 * then sends the response via the task's callbackChannel.
 */

import {
  markBackgroundTaskStarted,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskTimeout,
  getBackgroundTaskById,
} from "~/services/background-task.server";
import { logger } from "~/services/logger.service";
import { handleBackgroundMessage } from "~/services/channels/channel.service";

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
 * Process a background task using the channel pipeline
 */
export async function processBackgroundTask(
  payload: BackgroundTaskPayload,
): Promise<BackgroundTaskResult> {
  const { taskId, workspaceId, userId, timeoutMs } = payload;

  try {
    logger.info(`Processing background task ${taskId}`, { workspaceId });

    await markBackgroundTaskStarted(taskId);

    const task = await getBackgroundTaskById(taskId);
    if (!task) {
      throw new Error(`Background task ${taskId} not found`);
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      await handleBackgroundMessage(task);

      clearTimeout(timeoutId);
      await markBackgroundTaskCompleted(taskId, "Task completed");

      logger.info(`Background task ${taskId} completed`);

      return { success: true, status: "completed", result: "Task completed" };
    } catch (error) {
      clearTimeout(timeoutId);

      if (abortController.signal.aborted) {
        logger.info(`Background task ${taskId} timed out`);
        await markBackgroundTaskTimeout(taskId);
        return { success: false, status: "timeout", error: "Task exceeded timeout limit" };
      }

      throw error;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Background task ${taskId} failed`, { error });

    const task = await getBackgroundTaskById(taskId);
    if (task?.status === "cancelled") {
      return { success: false, status: "cancelled", error: "Task was cancelled" };
    }

    await markBackgroundTaskFailed(taskId, errorMsg);
    return { success: false, status: "failed", error: errorMsg };
  }
}
