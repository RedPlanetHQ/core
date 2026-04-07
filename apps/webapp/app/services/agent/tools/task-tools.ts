import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createTask,
  createScheduledTask,
  updateTask,
  updateScheduledTask,
  getTaskById,
  getTasks,
  searchTasks,
  changeTaskStatus,
  deleteTask,
  confirmTaskActive,
  rescheduleTaskAt,
  getScheduledTasksForWorkspace,
  recalculateTasksForTimezone,
  getTaskTree,
  reparentTask,
} from "~/services/task.server";
import {
  findOrCreateTaskPage,
  findOrCreateDailyPage,
} from "~/services/page.server";
import {
  setPageContentFromHtml,
  getPageContentAsHtml,
} from "~/services/hocuspocus/content.server";
import { logger } from "~/services/logger.service";
import type { TaskStatus } from "@prisma/client";
import { env } from "~/env.server";
import {
  computeNextRun,
  getRecurrenceIntervalMinutes,
  formatScheduleForUser,
} from "~/utils/schedule-utils";
import { textSimilarity } from "~/lib/utils";
import type { MessageChannel } from "~/services/agent/types";
import type { ChannelRecord } from "~/services/channel.server";
import { prisma } from "~/db.server";
import { enqueueTask } from "~/lib/queue-adapter.server";

export function getTaskTools(
  workspaceId: string,
  userId: string,
  isBackgroundExecution?: boolean,
  timezone: string = "UTC",
  channel: MessageChannel = "email",
  availableChannels: MessageChannel[] = ["email"],
  minRecurrenceMinutes: number = 60,
  channelRecords?: ChannelRecord[],
  currentTaskId?: string,
): Record<string, Tool> {
  const minRecurrenceLabel =
    minRecurrenceMinutes >= 60
      ? `${minRecurrenceMinutes / 60} hour${minRecurrenceMinutes > 60 ? "s" : ""}`
      : `${minRecurrenceMinutes} minutes`;

  // Build name → channel record lookup
  const channelByName = new Map<string, ChannelRecord>();
  if (channelRecords?.length) {
    for (const ch of channelRecords) {
      channelByName.set(ch.name, ch);
    }
  }

  // Build channel enum from records or fallback to types
  const channelNames = channelRecords?.length
    ? channelRecords.map((ch) => ch.name)
    : null;

  const channelSchema =
    channelNames && channelNames.length > 0
      ? z
          .string()
          .optional()
          .describe(
            `Channel to deliver on. Available: ${channelNames.join(", ")}. Defaults to user's default channel.`,
          )
      : z
          .enum(["whatsapp", "slack", "email", "telegram"])
          .optional()
          .describe(
            "Channel to deliver on. Defaults to user's default channel.",
          );

  return {
    ...(!isBackgroundExecution && {
      create_task: tool({
        description: `Create a new CORE internal task. Tasks can be immediate (work items) or scheduled (reminders, recurring checks).
NOTE: This is for CORE's own task system. If the user asks to create a task in an external tool (Todoist, Asana, Linear, Jira, etc.), do NOT use this — delegate to the orchestrator via take_action instead.

BEFORE CREATING: Always call search_tasks first. If a matching task already exists in Backlog/Todo/InProgress, reuse it instead of creating a duplicate.

IMMEDIATE TASK (no scheduling):
- Default status is Backlog — use when parking something for later ("don't forget X").
- Pass status="Todo" to start execution immediately — use when user wants it done now ("do X", "research Y", coding tasks).
- Pass status="Blocked" for approval-gated work — send_message explaining the plan, wait for user to unblock.

SCHEDULED TASK (one-time, fires at a specific time):
- Pass title + schedule (RRule) + maxOccurrences=1
- Example: "remind me at 2:30pm" → schedule="FREQ=DAILY;BYHOUR=14;BYMINUTE=30", maxOccurrences=1
- For future dates, add startDate: "tomorrow at 2pm" → schedule="FREQ=DAILY;BYHOUR=14", startDate="2026-01-15", maxOccurrences=1
- For relative times: "in 5 minutes" → schedule="FREQ=MINUTELY;INTERVAL=5", maxOccurrences=1

RECURRING TASK (fires on a schedule):
- Pass title + schedule (RRule). Omit maxOccurrences for unlimited.
- Example: "hydration every 2 hours" → schedule="FREQ=DAILY;BYHOUR=8,10,12,14,16,18,20"

MINIMUM RECURRENCE: For recurring tasks, minimum interval is ${minRecurrenceLabel}.

Schedule uses RRule format (times in user's local timezone):
- "FREQ=MINUTELY;INTERVAL=15" (every 15 min)
- "FREQ=HOURLY;INTERVAL=3" (every 3 hours)
- "FREQ=DAILY;BYHOUR=9" (9am daily)
- "FREQ=DAILY;BYHOUR=9;BYMINUTE=30" (9:30am daily)
- "FREQ=DAILY;BYHOUR=10,13,16,19,22" (multiple times daily)
- "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=10" (10am Mon/Wed/Fri)

TEXT GUIDELINES for scheduled tasks:
- Describe WHAT to do, not HOW or WHERE.
- Do NOT include channel delivery instructions — the channel is set separately.

FOLLOW-UP: Set isFollowUp=true and parentTaskId to reschedule an existing task.`,
        inputSchema: z.object({
          title: z.string().describe("Short title for the task"),
          description: z
            .string()
            .optional()
            .describe("Task description as HTML"),
          // Scheduling params (optional — omit for immediate tasks)
          schedule: z
            .string()
            .optional()
            .describe("RRule schedule string for scheduled/recurring tasks"),
          startDate: z
            .string()
            .optional()
            .describe("ISO 8601 date (YYYY-MM-DD) for when to start firing"),
          maxOccurrences: z
            .number()
            .optional()
            .describe(
              "Max times to fire. 1 for one-time, N for limited, omit for unlimited.",
            ),
          endDate: z
            .string()
            .optional()
            .describe("ISO 8601 date string for when to stop firing"),
          channel: channelSchema,
          isFollowUp: z
            .boolean()
            .optional()
            .describe("True if this is a follow-up for an existing task"),
          parentTaskId: z
            .string()
            .optional()
            .describe("ID of the parent task. Required if isFollowUp is true."),
          status: z
            .enum(["Backlog", "Todo", "Blocked"])
            .optional()
            .describe(
              "Initial status. Backlog=park for later (default). Todo=start immediately. Blocked=needs approval first.",
            ),
          skillId: z
            .string()
            .optional()
            .describe(
              "ID of a skill to attach. When the task fires, the skill is loaded and executed.",
            ),
          skillName: z
            .string()
            .optional()
            .describe("Name of the attached skill."),
        }),
        execute: async ({
          title,
          description,
          status: initialStatus,
          schedule,
          startDate,
          maxOccurrences,
          endDate,
          channel: taskChannel,
          isFollowUp,
          parentTaskId,
          skillId,
          skillName,
        }) => {
          try {
            // Follow-up: reschedule the parent task
            if (isFollowUp && parentTaskId) {
              const parentTask = await getTaskById(parentTaskId);
              if (!parentTask) return "Parent task not found.";

              if (!schedule) return "Schedule is required for follow-up.";

              const tz = timezone ?? "UTC";
              const followUpNextRun = computeNextRun(schedule, tz);
              if (!followUpNextRun) return "Could not compute follow-up time.";

              await rescheduleTaskAt(
                parentTaskId,
                workspaceId,
                followUpNextRun,
              );
              return `Follow-up scheduled: task fires again at ${followUpNextRun.toLocaleString()}.`;
            }

            // Scheduled or recurring task
            if (schedule) {
              // Enforce minimum recurrence interval
              const isRecurring = !maxOccurrences || maxOccurrences > 1;
              if (isRecurring) {
                const intervalMins = getRecurrenceIntervalMinutes(schedule);
                if (
                  intervalMins !== null &&
                  intervalMins < minRecurrenceMinutes
                ) {
                  return `Cannot create task: minimum recurrence interval is ${minRecurrenceLabel}.`;
                }
              }

              // Resolve channel
              let targetChannelName: string = channel;
              let targetChannelId: string | null = null;

              if (taskChannel) {
                const matchedByName = channelByName.get(taskChannel);
                if (matchedByName) {
                  targetChannelName = matchedByName.name;
                  targetChannelId = matchedByName.id;
                } else {
                  const asType = taskChannel as MessageChannel;
                  if (availableChannels.includes(asType)) {
                    targetChannelName = taskChannel;
                  } else {
                    const names = channelRecords?.length
                      ? channelRecords.map((ch) => ch.name).join(", ")
                      : availableChannels.join(", ");
                    return `Channel "${taskChannel}" is not available. Available: ${names}`;
                  }
                }
              }

              // Build metadata
              const metadata: Record<string, unknown> = {};
              if (skillId) {
                metadata.skillId = skillId;
                metadata.skillName = skillName || null;
              }

              const task = await createScheduledTask(workspaceId, userId, {
                title,
                description,
                schedule,
                channel: targetChannelName,
                channelId: targetChannelId,
                maxOccurrences:
                  maxOccurrences && maxOccurrences > 0 ? maxOccurrences : null,
                endDate: endDate ? new Date(endDate) : null,
                startDate: startDate ? new Date(startDate) : null,
                parentTaskId: parentTaskId ?? null,
                metadata: Object.keys(metadata).length > 0 ? metadata : null,
              });

              let limitInfo = "";
              const maxOcc =
                maxOccurrences && maxOccurrences > 0 ? maxOccurrences : null;
              if (maxOcc) {
                limitInfo =
                  maxOcc === 1 ? " (one-time)" : ` (${maxOcc} times max)`;
              } else if (endDate) {
                limitInfo = ` (until ${endDate})`;
              }

              const nextRunInfo = task.nextRunAt
                ? ` Next: ${task.nextRunAt.toLocaleString()}`
                : "";

              return `Created scheduled task: "${title}" (ID: ${task.id}).${nextRunInfo}${limitInfo}`;
            }

            // Immediate task (no scheduling)
            const task = await createTask(
              workspaceId,
              userId,
              title,
              undefined,
              {
                ...(parentTaskId && { parentTaskId }),
              },
            );
            if (description) {
              const page = await findOrCreateTaskPage(
                workspaceId,
                userId,
                task.id,
              );
              await setPageContentFromHtml(page.id, description);
            }
            // Move to target status — Todo triggers auto-execution, Blocked gates on approval
            if (initialStatus && initialStatus !== "Backlog") {
              await changeTaskStatus(
                task.id,
                initialStatus as any,
                workspaceId,
                userId,
              );
            }
            const label = parentTaskId ? "subtask" : "task";
            const targetStatus = initialStatus ?? "Backlog";
            const statusNote =
              targetStatus === "Todo"
                ? "Started in background."
                : targetStatus === "Blocked"
                  ? "Blocked — send_message to user explaining what's needed."
                  : "Added to Backlog.";
            logger.info(
              `Task ${task.id} created (${targetStatus})${parentTaskId ? ` subtask of ${parentTaskId}` : ""}`,
            );
            return `${label} created: "${title}" (ID: ${task.id}). ${statusNote} Link: ${env.APP_ORIGIN}/home/tasks?taskId=${task.id}`;
          } catch (error) {
            logger.error("Failed to create task", { error });
            return `Failed to create task: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      }),
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

          // Read description from linked page (HTML)
          let description = "(empty)";
          if (task.pageId) {
            const pageHtml = await getPageContentAsHtml(task.pageId);
            if (pageHtml) description = pageHtml;
          }

          const parts = [
            `Title: ${task.title}`,
            `Status: ${task.status}`,
            `Description: ${description}`,
            `ID: ${task.id}`,
            `Created: ${task.createdAt}`,
          ];

          if (task.schedule) {
            parts.push(
              `Schedule: ${formatScheduleForUser(task.schedule, timezone)}`,
            );
          }
          if (task.nextRunAt) {
            parts.push(`Next run: ${task.nextRunAt.toLocaleString()}`);
          }
          if (task.channel) {
            parts.push(`Channel: ${task.channel}`);
          }

          return parts.join("\n");
        } catch (error) {
          return `Failed to get task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    list_tasks: tool({
      description:
        "List tasks with their current status. Use type filter to see scheduled/recurring tasks separately.",
      inputSchema: z.object({
        status: z
          .enum([
            "Backlog",
            "Todo",
            "InProgress",
            "Blocked",
            "Completed",
            "Recurring",
          ])
          .optional()
          .describe("Filter by status. Omit to list all."),
        type: z
          .enum(["all", "immediate", "scheduled", "recurring"])
          .optional()
          .describe(
            "Filter by type: 'immediate' (no schedule), 'scheduled' (one-time), 'recurring'. Default: all.",
          ),
      }),
      execute: async ({ status, type }) => {
        try {
          let tasks;

          if (type === "scheduled" || type === "recurring") {
            // Get active scheduled tasks
            tasks = await getScheduledTasksForWorkspace(workspaceId);
            if (type === "recurring") {
              tasks = tasks.filter(
                (t) =>
                  t.schedule && (!t.maxOccurrences || t.maxOccurrences > 1),
              );
            } else {
              tasks = tasks.filter((t) => t.maxOccurrences === 1);
            }
          } else if (type === "immediate") {
            tasks = await getTasks(
              workspaceId,
              status as TaskStatus | undefined,
            );
            tasks = tasks.filter((t) => !t.schedule && !t.nextRunAt);
          } else {
            tasks = await getTasks(
              workspaceId,
              status as TaskStatus | undefined,
            );
          }

          if (tasks.length === 0) return "No tasks found.";

          const lines = await Promise.all(
            tasks.map(async (t, i) => {
              let info = `${i + 1}. [${t.status}] ${t.title}`;
              if (t.pageId) {
                const html = await getPageContentAsHtml(t.pageId);
                if (html) info += ` — ${html.substring(0, 100)}`;
              }
              if (t.schedule)
                info += ` (${formatScheduleForUser(t.schedule, timezone)})`;
              if (t.maxOccurrences) {
                const remaining = t.maxOccurrences - t.occurrenceCount;
                info +=
                  remaining === 1 ? " [one-time]" : ` [${remaining} left]`;
              }
              info += ` (ID: ${t.id})`;
              return info;
            }),
          );
          return lines.join("\n");
        } catch (error) {
          return "Failed to list tasks.";
        }
      },
    }),

    search_tasks: tool({
      description: `Find an existing task by keyword. Use when the user is referring to a task that already exists and you need to locate it. Searches across task titles and descriptions.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search keyword to match against task title and description",
          ),
      }),
      execute: async ({ query }) => {
        try {
          const tasks = await searchTasks(workspaceId, query);
          if (tasks.length === 0) return "No matching tasks found.";
          const lines = await Promise.all(
            tasks.map(async (t, i) => {
              let info = `${i + 1}. [${t.status}] ${t.title}`;
              if (t.pageId) {
                const html = await getPageContentAsHtml(t.pageId);
                if (html) info += ` — ${html.substring(0, 100)}`;
              }
              info += ` (ID: ${t.id})`;
              return info;
            }),
          );
          return lines.join("\n");
        } catch (error) {
          return "Failed to search tasks.";
        }
      },
    }),

    update_task: tool({
      description: `Update an existing task — change its status, title, description, scheduling, or parent. Description updates are APPENDED to existing content — just pass the new context, no need to read or merge.

REPARENTING: Pass newParentId to move a task under a different parent (or null to make it a root task). This deletes the task and recreates it under the new parent — the task gets a new displayId. Subtasks are also deleted.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID"),
        status: z
          .enum(["Backlog", "InProgress", "Blocked", "Completed", "Recurring"])
          .optional()
          .describe(
            "New status. To move a Blocked task to Todo, use unblock_task instead.",
          ),
        title: z.string().optional().describe("Updated title"),
        description: z
          .string()
          .optional()
          .describe(
            "Task description as HTML — appended to existing content by default",
          ),
        replaceDescription: z
          .boolean()
          .optional()
          .describe(
            "Set true to replace the entire description instead of appending. Default: false (append).",
          ),
        schedule: z.string().optional().describe("New RRule schedule string"),
        isActive: z
          .boolean()
          .optional()
          .describe("Set to false to pause, true to resume"),
        maxOccurrences: z
          .number()
          .optional()
          .describe("Update max occurrences limit"),
        endDate: z.string().optional().describe("Update end date (ISO 8601)"),
        channel: channelSchema,
        newParentId: z
          .string()
          .optional()
          .describe(
            "Move task under a new parent (UUID). Deletes and recreates the task with a new displayId. Omit if not reparenting.",
          ),
      }),
      execute: async ({
        taskId,
        status,
        title,
        description,
        replaceDescription,
        schedule,
        isActive,
        maxOccurrences,
        endDate,
        channel: updateChannel,
        newParentId,
      }) => {
        try {
          // Reparent: delete + recreate under new parent (requires a non-null string)
          if (typeof newParentId === "string") {
            const newTask = await reparentTask(
              taskId,
              newParentId,
              workspaceId,
              userId,
            );
            return `Task reparented. New ID: ${newTask.id}, displayId: ${(newTask as { displayId?: string | null }).displayId ?? "pending"}.`;
          }

          // Handle scheduling updates
          if (
            schedule !== undefined ||
            isActive !== undefined ||
            maxOccurrences !== undefined ||
            endDate !== undefined ||
            updateChannel !== undefined
          ) {
            await updateScheduledTask(taskId, workspaceId, {
              title,
              description,
              schedule,
              channel: updateChannel,
              isActive,
              maxOccurrences: maxOccurrences ?? undefined,
              endDate: endDate ? new Date(endDate) : undefined,
            });
          } else if (title || description !== undefined) {
            if (replaceDescription && description !== undefined) {
              const existingTask = await getTaskById(taskId);
              if (existingTask?.pageId) {
                const existingHtml =
                  (await getPageContentAsHtml(existingTask.pageId)) ?? "";
                if (existingHtml.length > 0) {
                  const similarity = textSimilarity(existingHtml, description);
                  if (similarity < 0.3) {
                    return `Description update rejected: the new content is too different from the existing description (similarity: ${Math.round(similarity * 100)}%). Prefer appending new context instead — omit replaceDescription and pass only the new content to append.`;
                  }
                }
              }
            }
            const data: { title?: string; description?: string } = {};
            if (title) data.title = title;
            if (description !== undefined) data.description = description;
            await updateTask(taskId, data, !replaceDescription);
          }

          if (status) {
            await changeTaskStatus(
              taskId,
              status as TaskStatus,
              workspaceId,
              userId,
            );
          }

          const parts = [];
          if (status) parts.push(`status → ${status}`);
          if (title) parts.push(`title updated`);
          if (description !== undefined) parts.push(`description updated`);
          if (schedule) parts.push(`schedule updated`);
          if (isActive !== undefined)
            parts.push(isActive ? "resumed" : "paused");
          return `Task ${taskId} updated: ${parts.join(", ")}.`;
        } catch (error) {
          return `Failed to update task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    unblock_task: tool({
      description: `Move a Blocked task to Todo so the agent can pick it up. Requires a reason explaining why the block is resolved. The reason is appended to the task description. Only works on tasks currently in Blocked status.`,
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the blocked task"),
        reason: z
          .string()
          .describe(
            "Why the block is resolved — this is appended to the task description",
          ),
      }),
      execute: async ({ taskId, reason }) => {
        try {
          const task = await getTaskById(taskId);
          if (!task) return `Task ${taskId} not found.`;
          if (task.status !== "Blocked")
            return `Task is not Blocked (current status: ${task.status}). Only Blocked tasks can be unblocked.`;

          // Append reason to description
          const page = task.pageId
            ? await prisma.page.findUnique({ where: { id: task.pageId } })
            : null;
          const existingHtml = page
            ? ((await getPageContentAsHtml(task.pageId!)) ?? "")
            : "";
          const reasonHtml = `<p><strong>Unblocked:</strong> ${reason}</p>`;
          const mergedHtml = existingHtml
            ? `${existingHtml}${reasonHtml}`
            : reasonHtml;

          if (task.pageId) {
            await setPageContentFromHtml(task.pageId, mergedHtml);
          }

          await changeTaskStatus(taskId, "Todo", workspaceId, userId);
          return `Task "${task.title}" unblocked and moved to Todo. Reason appended to description.`;
        } catch (error) {
          return `Failed to unblock task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    delete_task: tool({
      description:
        "Delete a task permanently. Use when user wants to cancel a task or scheduled item.",
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to delete"),
      }),
      execute: async ({ taskId }) => {
        try {
          await deleteTask(taskId, workspaceId);
          return "Task deleted.";
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to delete task";
        }
      },
    }),

    confirm_task: tool({
      description:
        "Confirm user wants to keep a scheduled task active. Stops future prompts about turning it off.",
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to confirm"),
      }),
      execute: async ({ taskId }) => {
        try {
          await confirmTaskActive(taskId, workspaceId);
          return "Task confirmed active.";
        } catch (error) {
          return "Failed to confirm task.";
        }
      },
    }),

    get_task_tree: tool({
      description: `Get the full ancestor chain for a task, from root down to the task itself. Use this to understand the hierarchy context — e.g. which epic/parent a task belongs to. Returns each ancestor's displayId and title in order.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID to get the tree for"),
      }),
      execute: async ({ taskId }) => {
        try {
          const tree = await getTaskTree(taskId);
          if (tree.length === 0) return `Task ${taskId} not found.`;
          return tree
            .map((t, i) => {
              const indent = "  ".repeat(i);
              const label =
                i === tree.length - 1
                  ? "(current)"
                  : i === 0
                    ? "(root)"
                    : "(parent)";
              return `${indent}${t.displayId ?? t.id} — ${t.title} ${label}`;
            })
            .join("\n");
        } catch (error) {
          return `Failed to get task tree: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    // reschedule_self — only available in background task execution
    ...(isBackgroundExecution &&
      currentTaskId && {
        reschedule_self: tool({
          description:
            "Reschedule this background task to run again after a delay. Use when waiting for a long-running coding or browser session. BEFORE calling this, save any state (sessionId, worktreePath, progress) to the task description via update_task — you will need it when you wake up. Max 6 reschedules per task.",
          inputSchema: z.object({
            minutesFromNow: z
              .number()
              .min(1)
              .max(60)
              .describe("Minutes to wait before re-executing this task"),
            reason: z
              .string()
              .optional()
              .describe("Why you are rescheduling (for logging)"),
          }),
          execute: async ({ minutesFromNow, reason }) => {
            try {
              const task = await getTaskById(currentTaskId);
              if (!task)
                return `Task ${currentTaskId} not found. Cannot reschedule.`;

              const metadata = (task.metadata as Record<string, unknown>) ?? {};
              const rescheduleCount = (metadata.rescheduleCount as number) ?? 0;

              if (rescheduleCount >= 6) {
                return "Max reschedules reached (6). Mark the task as Blocked and notify the user that the session timed out.";
              }

              // Increment reschedule count in metadata
              await prisma.task.update({
                where: { id: currentTaskId },
                data: {
                  metadata: {
                    ...metadata,
                    rescheduleCount: rescheduleCount + 1,
                  },
                },
              });

              // Enqueue delayed re-execution
              const delayMs = minutesFromNow * 60_000;
              await enqueueTask(
                { taskId: currentTaskId, workspaceId, userId },
                delayMs,
              );

              logger.info(
                `Task ${currentTaskId} rescheduled in ${minutesFromNow}m (count: ${rescheduleCount + 1}/6)${reason ? ` — ${reason}` : ""}`,
              );

              return `Rescheduled to run again in ${minutesFromNow} minutes (reschedule ${rescheduleCount + 1}/6). This execution will now end. Make sure you saved sessionId and any state to the task description before this point.`;
            } catch (error) {
              logger.error("Failed to reschedule task", { error });
              return `Failed to reschedule: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
          },
        }),
      }),

    set_timezone: tool({
      description:
        "Set user's timezone. Use when user mentions their timezone (e.g., 'i'm in PST', 'my timezone is IST'). This will also recalculate all existing scheduled task times to the new timezone.",
      inputSchema: z.object({
        timezone: z
          .string()
          .describe(
            "IANA timezone string (e.g., 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/London')",
          ),
      }),
      execute: async ({ timezone: newTimezone }) => {
        try {
          const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { UserWorkspace: { include: { user: true }, take: 1 } },
          });

          const user = workspace?.UserWorkspace[0]?.user;
          if (!user) return "failed to update timezone";

          const existingMetadata =
            (user.metadata as Record<string, unknown>) || {};
          const oldTimezone = (existingMetadata.timezone as string) || "UTC";

          await prisma.user.update({
            where: { id: user.id },
            data: {
              metadata: {
                ...existingMetadata,
                timezone: newTimezone,
              },
            },
          });

          if (oldTimezone !== newTimezone) {
            const { updated } = await recalculateTasksForTimezone(
              workspaceId,
              oldTimezone,
              newTimezone,
            );
            if (updated > 0) {
              return `timezone set to ${newTimezone}. ${updated} scheduled task(s) adjusted.`;
            }
          }

          return `timezone set to ${newTimezone}. no scheduled tasks to adjust.`;
        } catch (error) {
          logger.error("Failed to update timezone", { error });
          return "failed to update timezone";
        }
      },
    }),

    get_scratchpad: tool({
      description: `Read the user's daily scratchpad page for a given date. Returns the page content as HTML. Use this to see what the user has written on their scratchpad for a specific day.`,
      inputSchema: z.object({
        date: z
          .string()
          .describe(
            "The date to read the scratchpad for, in YYYY-MM-DD format. Defaults to today if omitted.",
          )
          .optional(),
      }),
      execute: async ({ date }) => {
        try {
          const target = date ? new Date(date) : new Date();
          target.setUTCHours(0, 0, 0, 0);

          const page = await prisma.page.findUnique({
            where: {
              workspaceId_userId_date: {
                workspaceId,
                userId,
                date: target,
              },
            },
            select: { id: true },
          });

          if (!page) {
            return `No scratchpad page found for ${target.toISOString().slice(0, 10)}.`;
          }

          const content = await getPageContentAsHtml(page.id);
          if (!content) {
            return `Scratchpad for ${target.toISOString().slice(0, 10)} is empty.`;
          }

          return `Scratchpad (${target.toISOString().slice(0, 10)}):\n${content}`;
        } catch (error) {
          return `Failed to read scratchpad: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    update_scratchpad: tool({
      description: `Append content to the user's daily scratchpad page for a given date. Creates the page if it doesn't exist. Content is always appended — never replaces existing content.`,
      inputSchema: z.object({
        content: z
          .string()
          .describe("HTML content to append to the scratchpad page"),
        date: z
          .string()
          .optional()
          .describe(
            "The date to write to, in YYYY-MM-DD format. Defaults to today if omitted.",
          ),
      }),
      execute: async ({ content, date }) => {
        try {
          const target = date ? new Date(date) : new Date();
          target.setUTCHours(0, 0, 0, 0);

          const page = await findOrCreateDailyPage(workspaceId, userId, target);

          const existing = (await getPageContentAsHtml(page.id)) ?? "";
          const merged = existing ? `${existing}${content}` : content;
          await setPageContentFromHtml(page.id, merged);

          return `Scratchpad updated for ${target.toISOString().slice(0, 10)}.`;
        } catch (error) {
          return `Failed to update scratchpad: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
