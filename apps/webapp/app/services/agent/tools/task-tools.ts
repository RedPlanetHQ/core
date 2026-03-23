import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createTask,
  getTaskById,
  getTasks,
  searchTasks,
  updateTask,
  changeTaskStatus,
} from "~/services/task.server";
import { enqueueTask } from "~/lib/queue-adapter.server";
import { logger } from "~/services/logger.service";
import type { TaskStatus } from "@prisma/client";
import { env } from "~/env.server";

export function getTaskTools(
  workspaceId: string,
  userId: string,
): Record<string, Tool> {
  return {
    create_task: tool({
      description: `Create a new task. Use when the user wants to capture something to be done — not when they're referring to an existing task. Tasks are always created in Backlog. Use run_task_in_background separately to start working on a task.`,
      inputSchema: z.object({
        title: z.string().describe("Short title for the task"),
        description: z
          .string()
          .optional()
          .describe("Detailed description of what to do"),
      }),
      execute: async ({ title, description }) => {
        try {
          const task = await createTask(workspaceId, userId, title, description);
          logger.info(`Task ${task.id} created in Backlog`);
          return `Task created: "${title}" (ID: ${task.id}). Added to Backlog. Link: ${env.APP_ORIGIN}/home/tasks?taskId=${task.id}`;
        } catch (error) {
          logger.error("Failed to create task", { error });
          return `Failed to create task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    get_task: tool({
      description: `Get full details of a task including its complete description. Use before updating a task so you can see what's already there and merge new context into it.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID"),
      }),
      execute: async ({ taskId }) => {
        try {
          const task = await getTaskById(taskId);
          if (!task) return `Task ${taskId} not found.`;
          return [
            `Title: ${task.title}`,
            `Status: ${task.status}`,
            `Description: ${task.description || "(empty)"}`,
            `ID: ${task.id}`,
            `Created: ${task.createdAt}`,
          ].join("\n");
        } catch (error) {
          return `Failed to get task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    run_task_in_background: tool({
      description: `Hand off a task to a background agent for execution. Use when the user wants something done that takes time — coding tasks, research, browser operations, anything that runs for minutes.

The background agent will handle the work autonomously. It will create reminders internally if it starts a long-running session (coding, browser) — you do NOT need to create a reminder yourself.

After calling this:
- Tell the user the task is running in the background
- Say you'll notify them when it's done
- Do NOT call take_action for the same task
- Do NOT create a reminder yourself

When the user asks to work on something, search existing tasks first (search_tasks). If a matching Backlog/Todo task exists, use its ID here instead of creating a new one.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID to run in the background"),
      }),
      execute: async ({ taskId }) => {
        try {
          const task = await getTaskById(taskId);
          if (!task) return `Task ${taskId} not found.`;
          await changeTaskStatus(taskId, "InProgress", workspaceId, userId);
          await enqueueTask({ taskId, workspaceId, userId });
          logger.info(`Task ${taskId} started in background`);
          return `Task "${task.title}" (taskId: ${taskId}) is now running in the background. The background agent will handle it. Tell the user it's running and you'll ping them when done.`;
        } catch (error) {
          logger.error("Failed to start background task", { error });
          return `Failed to start task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    list_tasks: tool({
      description: "List tasks with their current status.",
      inputSchema: z.object({
        status: z
          .enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"])
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

    search_tasks: tool({
      description: `Find an existing task by keyword. Use when the user is referring to a task that already exists and you need to locate it. Searches across task titles and descriptions.`,
      inputSchema: z.object({
        query: z.string().describe("Search keyword to match against task title and description"),
      }),
      execute: async ({ query }) => {
        try {
          const tasks = await searchTasks(workspaceId, query);
          if (tasks.length === 0) return "No matching tasks found.";
          return tasks
            .map(
              (t, i) =>
                `${i + 1}. [${t.status}] ${t.title}${t.description ? ` — ${t.description.substring(0, 100)}` : ""} (ID: ${t.id})`,
            )
            .join("\n");
        } catch (error) {
          return "Failed to search tasks.";
        }
      },
    }),

    update_task: tool({
      description: `Update an existing task — change its status, title, or description. When updating the description, ALWAYS call get_task first to read the current description, then write a merged version that includes both old and new context. Never blindly replace — accumulate.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID"),
        status: z
          .enum(["Backlog", "Todo", "InProgress", "Blocked", "Completed"])
          .optional()
          .describe("New status"),
        title: z.string().optional().describe("Updated title"),
        description: z.string().optional().describe("Updated description — this becomes context when the agent executes the task"),
      }),
      execute: async ({ taskId, status, title, description }) => {
        try {
          if (title || description !== undefined) {
            const data: { title?: string; description?: string } = {};
            if (title) data.title = title;
            if (description !== undefined) data.description = description;
            await updateTask(taskId, data);
          }
          if (status) {
            await changeTaskStatus(taskId, status as TaskStatus, workspaceId, userId);
          }
          const parts = [];
          if (status) parts.push(`status → ${status}`);
          if (title) parts.push(`title updated`);
          if (description !== undefined) parts.push(`description updated`);
          return `Task ${taskId} updated: ${parts.join(", ")}.`;
        } catch (error) {
          return `Failed to update task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
