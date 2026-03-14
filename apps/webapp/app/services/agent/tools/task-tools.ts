import { tool, type Tool } from "ai";
import { z } from "zod";
import { createTask, getTasks, updateTaskStatus } from "~/services/task.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";
import type { TaskStatus } from "@prisma/client";

export function getTaskTools(
  workspaceId: string,
  userId: string,
): Record<string, Tool> {
  return {
    create_task: tool({
      description: `Create a task for the agent to work on asynchronously. Use when:
- User asks to do something that takes a while
- User says "let me know when done" or similar
- Task requires autonomous multi-step work

The task runs in the background. The conversation will be linked to the task.`,
      inputSchema: z.object({
        title: z.string().describe("Short title for the task"),
        description: z
          .string()
          .optional()
          .describe("Detailed description of what to do"),
      }),
      execute: async ({ title, description }) => {
        try {
          const task = await createTask(
            workspaceId,
            userId,
            title,
            description,
          );
          await enqueueTask({ taskId: task.id, workspaceId, userId });
          logger.info(`Task ${task.id} created and enqueued`);
          return `Task created: "${title}" (ID: ${task.id}). It's queued and will start shortly.`;
        } catch (error) {
          logger.error("Failed to create task", { error });
          return `Failed to create task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    list_tasks: tool({
      description: "List tasks with their current status.",
      inputSchema: z.object({
        status: z
          .enum(["Backlog", "Todo", "InProgress", "Review", "Completed"])
          .optional()
          .describe("Filter by status. Omit to list all."),
      }),
      execute: async ({ status }) => {
        try {
          const tasks = await getTasks(
            workspaceId,
            status as TaskStatus | undefined,
          );
          if (tasks.length === 0) return "No tasks found.";
          return tasks
            .map(
              (t, i) =>
                `${i + 1}. [${t.status}] ${t.title}${t.description ? ` — ${t.description.substring(0, 60)}` : ""} (ID: ${t.id})`,
            )
            .join("\n");
        } catch (error) {
          return "Failed to list tasks.";
        }
      },
    }),

    update_task_status: tool({
      description: "Move a task to a different status.",
      inputSchema: z.object({
        taskId: z.string().describe("The task ID"),
        status: z
          .enum(["Backlog", "Todo", "InProgress", "Review", "Completed"])
          .describe("New status"),
      }),
      execute: async ({ taskId, status }) => {
        try {
          await updateTaskStatus(taskId, status as TaskStatus);
          return `Task ${taskId} moved to ${status}.`;
        } catch (error) {
          return `Failed to update task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
