import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createTask,
  getTasks,
  searchTasks,
  updateTask,
  changeTaskStatus,
} from "~/services/task.server";
import { logger } from "~/services/logger.service";
import type { TaskStatus } from "@prisma/client";

export function getTaskTools(
  workspaceId: string,
  userId: string,
): Record<string, Tool> {
  return {
    create_task: tool({
      description: `Create a new task that doesn't already exist. Use when the user wants to capture something new to be done — not when they're referring to an existing task.

enqueue=true: User wants it done now — task gets picked up and worked on in the background immediately.
enqueue=false: User is just capturing it for later — task goes to Backlog and stays there until they're ready.`,
      inputSchema: z.object({
        title: z.string().describe("Short title for the task"),
        description: z
          .string()
          .optional()
          .describe("Detailed description of what to do"),
        enqueue: z
          .boolean()
          .optional()
          .default(false)
          .describe("true = start working on it now. false = save to Backlog for later."),
      }),
      execute: async ({ title, description, enqueue }) => {
        try {
          const task = await createTask(workspaceId, userId, title, description);
          if (enqueue) {
            await changeTaskStatus(task.id, "Todo", workspaceId, userId);
            logger.info(`Task ${task.id} created and enqueued`);
            return `Task created: "${title}" (ID: ${task.id}). Queued and starting shortly.`;
          }
          logger.info(`Task ${task.id} created in Backlog`);
          return `Task created: "${title}" (ID: ${task.id}). Added to Backlog.`;
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
      description: `Update an existing task — change its status, title, or description. Use when moving a task through the lifecycle or when the user provides more context about a task. The description is what the agent sees as context when executing the task, so accumulate relevant details there.`,
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
