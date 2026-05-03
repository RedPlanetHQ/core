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
import { upsertPageSection } from "~/services/coding-task.server";
import { createEmptyConversation } from "~/services/conversation.server";
import { logger } from "~/services/logger.service";
import type { TaskStatus } from "@prisma/client";
import { UserTypeEnum } from "@core/types";
import { getTaskPhase } from "~/services/task.phase";
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
  source?: string,
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
    create_task: tool({
      description: `Create a new CORE internal task. Tasks can be immediate (work items) or scheduled (reminders, recurring checks).
NOTE: This is for CORE's own task system. If the user asks to create a task in an external tool (Todoist, Asana, Linear, Jira, etc.), do NOT use this — delegate to the orchestrator via take_action instead.

BACKGROUND CONTEXT RULE: when called from inside a running task (prep or execute, i.e. <task_prep> or <task_execution> is in your system prompt), parentTaskId is MANDATORY — pass the current task's ID. You can only create SUBTASKS in background, never top-level tasks. Top-level task creation is reserved for the foreground chat agent. This prevents background runs from spawning unrelated work.

BEFORE CREATING: Always call search_tasks first. If a matching task already exists in Todo/Working, reuse it instead of creating a duplicate.

IMMEDIATE TASK (no scheduling):
- Default status is Todo — use for active work items, planning, and tracked tasks.
- Pass status="Waiting" for approval-gated work — send_message explaining the plan, wait for user to approve.

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
            .enum(["Todo", "Waiting", "Ready"])
            .optional()
            .describe(
              "Initial status, classified by the rules in <capabilities> STARTING WORK. Todo = COMPLEX work (multi-step, decomposable, irreversible bulk). 2-min prep buffer applies. Ready = SIMPLE + CLEAR (single action, well-scoped). 2-min buffer still applies (gives the user a window to add context); execution starts after expiry. Waiting = SIMPLE + UNCLEAR (need one question answered) OR needs explicit user approval. Send_message the question/plan, then unblock_task when answered.",
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
            // BACKGROUND CONTEXT GUARD: when invoked from inside a running task,
            // only subtask creation is allowed. Top-level task creation in
            // background would let prep/execute runs spawn unrelated work — a
            // common foot-gun. Foreground chat is unaffected.
            if (isBackgroundExecution && !parentTaskId) {
              return "create_task in background context requires parentTaskId — only subtask creation is permitted from inside a running task. If you need a top-level task, the user must create it from the foreground chat.";
            }

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
            // Subtasks default to Waiting (they sit idle until parent is approved
            // and the system transitions them to Todo sequentially).
            // Top-level tasks default to Todo (with 2-min prep buffer).
            const effectiveStatus =
              parentTaskId && !initialStatus ? "Waiting" : undefined;

            // Pass the resolved status directly to createTask. createTask
            // applies the 2-min buffer for Todo (anyone) and for Ready+agent
            // (skip-prep path); Waiting (subtask default or agent-requested
            // approval) lands without a buffer. The old post-create
            // changeTaskStatus flip is no longer needed for non-subtask
            // flows.
            const resolvedStatus = (effectiveStatus ??
              initialStatus ??
              "Todo") as TaskStatus;

            const task = await createTask(
              workspaceId,
              userId,
              title,
              undefined,
              {
                actor: "agent",
                status: resolvedStatus,
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
            const label = parentTaskId ? "subtask" : "task";
            const targetStatus = resolvedStatus;
            const statusNote =
              targetStatus === "Waiting"
                ? parentTaskId
                  ? "Waiting — will run when parent is approved. The task executes in its own thread; do not do its work in the current conversation."
                  : "Waiting — send_message to user explaining what's needed. Once unblocked, the task executes in its own thread; do not do its work in the current conversation."
                : `Added to ${targetStatus} (planning). The task will be picked up and executed in its own thread — do NOT do its work in the current conversation; just acknowledge creation and stop.`;
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
            "Todo",
            "Waiting",
            "Ready",
            "Working",
            "Review",
            "Done",
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
      description: `Update an existing task — change its status, title, description, scheduling, or parent.

DESCRIPTION CONTENT (the task body the user reads):

The description has two structured zones the agent owns. Pass HTML in the \`description\` parameter containing one or both of these tags:

- <plan>...</plan> — the current plan or step-by-step approach you are following. Rewrite this in full whenever the plan changes.
- <output>...</output> — the result the user reads when the work is done. Replace each run.

Strict input contract: at most ONE <plan> tag and at most ONE <output> tag per call. Multiple of either returns an error and the description is not updated. To update both at once, send HTML containing both tags in a single call.

Anything outside these tags is silently dropped — the user's prose elsewhere on the page is sacred and never modified by this tool. Do NOT use the description for status updates, error logs, or transient state; status updates go via send_message.

REPARENTING: Pass newParentId to move a task under a different parent (or null to make it a root task). This deletes the task and recreates it under the new parent — the task gets a new displayId. Subtasks are also deleted.`,
      inputSchema: z.object({
        taskId: z.string().describe("The task ID"),
        status: z
          .enum(["Waiting", "Review"])
          .optional()
          .describe(
            "New status. Waiting = needs user input. Review = work is done, your terminal state — once set, stop. The user will move Review → Done. To approve a Waiting task, use unblock_task. Working is set automatically by the system when a task starts running — agents must never set it.",
          ),
        title: z.string().optional().describe("Updated title"),
        description: z
          .string()
          .optional()
          .describe(
            "Task description as HTML — provide <plan>...</plan> and/or <output>...</output> tags to upsert those sections. At most one of each per call. Other content is dropped.",
          ),
        replaceDescription: z
          .boolean()
          .optional()
          .describe(
            "Set true to replace the entire description verbatim (only valid for task creation flows where the agent writes the user's prose from a brief). Default: false — description is merged via <plan>/<output> upsert.",
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

          // Fetch task once for recurring check and reuse
          const currentTask = await getTaskById(taskId);
          const isRecurring = !!currentTask?.schedule;

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
              // Never update description for recurring tasks — it pollutes the
              // next run's context. Results go via send_message.
              description: isRecurring ? undefined : description,
              schedule,
              channel: updateChannel,
              isActive,
              maxOccurrences: maxOccurrences ?? undefined,
              endDate: endDate ? new Date(endDate) : undefined,
            });
          } else if (!isRecurring && (title || description !== undefined)) {
            // Description / title update — silently skipped for recurring tasks.
            if (description !== undefined && currentTask?.pageId) {
              if (replaceDescription) {
                const existingHtml =
                  (await getPageContentAsHtml(currentTask.pageId)) ?? "";
                if (existingHtml.length > 0) {
                  const similarity = textSimilarity(existingHtml, description);
                  if (similarity < 0.3) {
                    return `Description update rejected: the new content is too different from the existing description (similarity: ${Math.round(similarity * 100)}%). Omit replaceDescription and pass <plan>/<output> tags to upsert sections instead.`;
                  }
                }
                await setPageContentFromHtml(currentTask.pageId, description);
              } else {
                await upsertPageSection(currentTask.pageId, description);
              }
            }
            if (title) {
              await updateTask(taskId, { title }, false);
            }
          } else if (isRecurring && title) {
            // Recurring tasks: allow title updates only (no description)
            await updateTask(taskId, { title }, false);
          }

          if (status) {
            if (isRecurring) {
              // Recurring tasks: silently map Done to Review, allow other statuses
              const effectiveStatus = status === "Done" ? "Review" : status;
              try {
                await changeTaskStatus(
                  taskId,
                  effectiveStatus as TaskStatus,
                  workspaceId,
                  userId,
                  "agent",
                );
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Status change rejected: ${msg}.`;
              }
            } else {
              try {
                await changeTaskStatus(
                  taskId,
                  status as TaskStatus,
                  workspaceId,
                  userId,
                  "agent",
                );
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Status change rejected: ${msg}. Review is your final state — stop here. The user will move it to Done.`;
              }
            }
          }

          const parts = [];
          if (status) parts.push(`status → ${status}`);
          if (title) parts.push(`title updated`);
          if (description !== undefined && !isRecurring)
            parts.push(`description updated`);
          if (description !== undefined && isRecurring)
            parts.push(
              `description skipped (recurring task — use send_message for results)`,
            );
          if (schedule) parts.push(`schedule updated`);
          if (isActive !== undefined)
            parts.push(isActive ? "resumed" : "paused");
          return `Task ${taskId} updated: ${parts.join(", ")}.`;
        } catch (error) {
          return `Failed to update task: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    // unblock_task — available in all flows (web chat, channels, etc.)
    ...(source && {
      unblock_task: tool({
        description: `Approve a Waiting task and move it to Ready (or Todo for prep-phase tasks) so execution can start. Requires a reason explaining why the wait is resolved. The reason is added to the task's conversation as a user reply, so the agent picks it up on its next turn. Only works on tasks currently in Waiting status.`,
        inputSchema: z.object({
          taskId: z.string().describe("The ID of the waiting task"),
          reason: z
            .string()
            .describe(
              "Why the wait is resolved — added to the task conversation as your reply so the agent resumes from there.",
            ),
        }),
        execute: async ({ taskId, reason }) => {
          try {
            const task = await getTaskById(taskId);
            if (!task) return `Task ${taskId} not found.`;
            if (task.status !== "Waiting")
              return `Task is not Waiting (current status: ${task.status}). Only Waiting tasks can be approved.`;

            // Resolve the most recent conversation tied to this task, or
            // create a new one if none exists. Then insert the reason as a
            // userType: User row so the agent's next turn picks it up like
            // a normal user reply and resumes the conversation.
            let conversationId =
              task.conversationIds[task.conversationIds.length - 1] ?? null;

            if (conversationId) {
              const exists = await prisma.conversation.findUnique({
                where: { id: conversationId },
                select: { id: true },
              });
              if (!exists) conversationId = null;
            }

            if (!conversationId) {
              const conv = await createEmptyConversation(
                workspaceId,
                userId,
                task.title,
                task.id,
              );
              conversationId = conv.id;
              await prisma.task.update({
                where: { id: task.id },
                data: { conversationIds: { push: conv.id } },
              });
            }

            await prisma.conversationHistory.create({
              data: {
                conversationId,
                userType: UserTypeEnum.User,
                message: reason,
                parts: [{ type: "text", text: reason }],
                ...(userId && { userId }),
              },
            });

            // Phase-aware: prep → back to Todo (continue planning),
            // execute → Ready (auto-enqueues, resumes execution).
            // EXCEPTION: if task has Waiting subtasks (butler decomposed it),
            // approval means "start the subtask chain" — go to Ready.
            const phase = getTaskPhase(task);
            const waitingSubtaskCount = await prisma.task.count({
              where: { parentTaskId: taskId, status: "Waiting" },
            });
            const hasWaitingSubtasks = waitingSubtaskCount > 0;
            const targetStatus =
              phase === "prep" && !hasWaitingSubtasks ? "Todo" : "Ready";

            await changeTaskStatus(
              taskId,
              targetStatus,
              workspaceId,
              userId,
              "user",
            );
            return `Task "${task.title}" unblocked and resumed in its own conversation. Tell the user it's being worked on. Do NOT take any further action on this task — it handles itself from here.`;
          } catch (error) {
            return `Failed to unblock task: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      }),
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
            "Reschedule this background task to run again after a delay. Use ONLY during execution phase (coding/browser sessions), NOT during brainstorming or planning — use sleep+poll for those. BEFORE calling this, save any state (sessionId, worktreePath, progress) to the task description via update_task — you will need it when you wake up. Max 10 reschedules per task.",
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

              if (rescheduleCount >= 10) {
                return "Max reschedules reached (10). Mark the task as Waiting and notify the user that the session timed out.";
              }

              const delayMs = minutesFromNow * 60_000;
              const nextRunAt = new Date(Date.now() + delayMs);

              await prisma.task.update({
                where: { id: currentTaskId },
                data: {
                  nextRunAt,
                  isActive: true,
                  metadata: {
                    ...metadata,
                    rescheduleCount: rescheduleCount + 1,
                  },
                },
              });

              await enqueueTask(
                { taskId: currentTaskId, workspaceId, userId },
                delayMs,
              );

              logger.info(
                `Task ${currentTaskId} rescheduled in ${minutesFromNow}m (count: ${rescheduleCount + 1}/10)${reason ? ` — ${reason}` : ""}`,
              );

              return `Rescheduled to run again in ${minutesFromNow} minutes (reschedule ${rescheduleCount + 1}/10). This execution will now end. Make sure you saved sessionId and any state to the task description before this point.`;
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
