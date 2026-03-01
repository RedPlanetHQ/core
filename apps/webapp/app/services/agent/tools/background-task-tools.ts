/**
 * Background Task Tools for Core Agent
 *
 * Provides spawn_background_task, list_background_tasks, and cancel_background_task
 * tools for the agent to manage long-running background tasks.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createBackgroundTask,
  getActiveBackgroundTasks,
  cancelBackgroundTask,
  getBackgroundTasks,
} from "~/services/background-task.server";
import { enqueueBackgroundTask } from "~/lib/queue-adapter.server";
import type { MessageChannel } from "~/services/agent/types";
import { logger } from "~/services/logger.service";

/**
 * Get background task management tools for the core agent
 *
 * @param workspaceId - The workspace ID
 * @param userId - The user ID
 * @param channel - Current channel (whatsapp, slack, email, or web)
 * @param conversationId - For web channel, the conversation ID to callback to
 * @param channelMetadata - Additional channel-specific metadata (e.g., slackUserId, threadTs)
 */
export function getBackgroundTaskTools(
  workspaceId: string,
  userId: string,
  channel: MessageChannel | "web",
  conversationId?: string,
  channelMetadata?: Record<string, unknown>,
): Record<string, Tool> {
  return {
    spawn_background_task: tool({
      description: `Start a long-running task in the background. Use this when:
- User asks to check something periodically and report back
- User wants to run a task that may take a while (coding, browser automation)
- User says "let me know when done" or "notify me when complete"

The task runs autonomously and will notify the user on the current channel when done.
Maximum 5 active tasks per workspace. Default timeout: 30 minutes.

Examples:
- "Check the deployment status every 5 minutes and let me know when it's done"
- "Run the test suite in the background and notify me of the results"
- "Monitor my PR for approval and tell me when it's merged"`,
      inputSchema: z.object({
        intent: z
          .string()
          .describe(
            "Clear description of what the task should do. Include success/failure conditions if applicable.",
          ),
        timeoutMinutes: z
          .number()
          .min(1)
          .max(60)
          .optional()
          .describe("Timeout in minutes. Default: 30, Max: 60"),
      }),
      execute: async ({ intent, timeoutMinutes }) => {
        try {
          const timeoutMs = (timeoutMinutes ?? 30) * 60 * 1000;

          logger.info(
            `Spawning background task for workspace ${workspaceId}: ${intent.substring(0, 100)}`,
          );

          // Create the task record with callback channel info captured from closure
          const task = await createBackgroundTask(workspaceId, {
            intent,
            userId,
            timeoutMs,
            callbackChannel: channel,
            callbackConversationId: conversationId,
            callbackMetadata: channelMetadata,
          });

          // Enqueue the job
          const { id: jobId } = await enqueueBackgroundTask({
            taskId: task.id,
            workspaceId,
            userId,
            intent,
            timeoutMs,
          });

          logger.info(`Background task ${task.id} enqueued with job ${jobId}`);

          const timeoutStr = timeoutMinutes
            ? `${timeoutMinutes} minute${timeoutMinutes > 1 ? "s" : ""}`
            : "30 minutes";

          return `Background task started. I'll notify you on ${channel} when it's done or if there's an issue. Timeout: ${timeoutStr}. Task ID: ${task.id}`;
        } catch (error) {
          logger.error("Failed to spawn background task", { error });
          if (error instanceof Error) {
            return `Failed to start background task: ${error.message}`;
          }
          return "Failed to start background task. Please try again.";
        }
      },
    }),

    list_background_tasks: tool({
      description:
        "List active background tasks. Shows pending and running tasks for the current workspace.",
      inputSchema: z.object({
        includeCompleted: z
          .boolean()
          .optional()
          .describe("Include recently completed/failed tasks. Default: false"),
      }),
      execute: async ({ includeCompleted }) => {
        try {
          const statuses = includeCompleted
            ? ["pending", "running", "completed", "failed", "timeout"]
            : ["pending", "running"];

          const tasks = await getBackgroundTasks(workspaceId, {
            status: statuses as any,
            limit: 10,
          });

          if (tasks.length === 0) {
            return "No active background tasks.";
          }

          const taskList = tasks
            .map((t, i) => {
              const statusEmoji =
                t.status === "running"
                  ? "🔄"
                  : t.status === "pending"
                    ? "⏳"
                    : t.status === "completed"
                      ? "✅"
                      : t.status === "failed"
                        ? "❌"
                        : t.status === "timeout"
                          ? "⏰"
                          : "🚫";

              const intentPreview =
                t.intent.length > 60
                  ? t.intent.substring(0, 60) + "..."
                  : t.intent;

              let details = `${statusEmoji} ${t.status}`;
              if (t.status === "running" && t.startedAt) {
                const runningFor = Math.floor(
                  (Date.now() - t.startedAt.getTime()) / 60000,
                );
                details += ` (${runningFor}m)`;
              }

              return `${i + 1}. "${intentPreview}" - ${details} [id:${t.id}]`;
            })
            .join("\n");

          return `Background tasks:\n${taskList}`;
        } catch (error) {
          logger.error("Failed to list background tasks", { error });
          return "Failed to retrieve background tasks.";
        }
      },
    }),

    cancel_background_task: tool({
      description:
        "Cancel a running or pending background task. Use the task ID from list_background_tasks.",
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to cancel"),
      }),
      execute: async ({ taskId }) => {
        try {
          logger.info(`Cancelling background task ${taskId}`);
          await cancelBackgroundTask(taskId, workspaceId);
          return `Background task ${taskId} cancelled.`;
        } catch (error) {
          logger.error("Failed to cancel background task", { error });
          if (error instanceof Error) {
            return error.message;
          }
          return "Failed to cancel background task.";
        }
      },
    }),
  };
}
