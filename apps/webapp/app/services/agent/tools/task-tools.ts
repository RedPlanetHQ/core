import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  createTask,
  createScheduledTask,
  updateTask,
  updateScheduledTask,
  getTaskById,
  getTasks,
  changeTaskStatus,
  deleteTask,
  rescheduleTaskAt,
  getScheduledTasksForWorkspace,
  recalculateTasksForTimezone,
  getTaskTree,
  reparentTask,
  resolveTaskId,
} from "~/services/task.server";
import {
  findOrCreateTaskPage,
  findOrCreateDailyPage,
} from "~/services/page.server";
import {
  setPageContentFromHtml,
  getPageContentAsHtml,
} from "~/services/hocuspocus/content.server";
import {
  upsertPageSection,
  clearPageSection,
} from "~/services/coding-task.server";
import { createEmptyConversation } from "~/services/conversation.server";
import { logger } from "~/services/logger.service";
import { Prisma, type TaskStatus } from "@prisma/client";
import { UserTypeEnum } from "@core/types";
import { getTaskPhase, setTaskPhaseInMetadata } from "~/services/task.phase";
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

  // Agent tools speak displayIds (tk-xxxxx). Resolve to UUID at the boundary;
  // everything downstream still uses UUIDs. Returns the UUID string or an
  // error string the tool can return verbatim to the model.
  const resolve = async (
    label: string,
    input: string,
  ): Promise<string | { error: string }> => {
    const uuid = await resolveTaskId(input, workspaceId);
    if (!uuid) return { error: `${label} "${input}" not found in this workspace.` };
    return uuid;
  };

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

BACKGROUND CONTEXT RULE: when called from inside a running task (i.e. <task_planning> or <task_execution> is in your system prompt), parentTaskId is MANDATORY — pass the current task's ID. You can only create SUBTASKS in background, never top-level tasks. Top-level task creation is reserved for the foreground chat agent. This prevents background runs from spawning unrelated work.

BEFORE CREATING: call list_tasks (filter by status Todo or Working) and scan the titles — if a matching task already exists, reuse it instead of creating a duplicate. There is no keyword search; list-and-pick.

IMMEDIATE TASK (no scheduling):
- Default status is Ready — the task buffers briefly, then executes. Use this for any work the user delegated to you that should run.
- Pass status="Todo" only when you want to PARK the task without running it (e.g. a backlog item the user said "later" to). Todo does NOT auto-buffer; promote to Ready (via UI or unblock_task) to start.
- Pass status="Waiting" for approval-gated work — send_message explaining the plan, wait for user to approve. The user's reply triggers unblock_task → Ready → buffer + execute.

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
            .describe(
              "displayId of the parent task (e.g. tk-abcde). Required if isFollowUp is true.",
            ),
          status: z
            .enum(["Todo", "Waiting", "Ready"])
            .optional()
            .describe(
              "Initial status. Ready (default for agent-created) = runs after a brief editing buffer; the user has that window to edit before execution starts. Todo = backlog — the task sits idle and only runs once the user (or unblock_task) moves it to Ready. Waiting = needs explicit user input or approval; send_message the question/plan, then unblock_task when answered.",
            ),
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
        }) => {
          try {
            // BACKGROUND CONTEXT GUARD: when invoked from inside a running task,
            // only subtask creation is allowed. Top-level task creation in
            // background would let prep/execute runs spawn unrelated work — a
            // common foot-gun. Foreground chat is unaffected.
            if (isBackgroundExecution && !parentTaskId) {
              return "create_task in background context requires parentTaskId — only subtask creation is permitted from inside a running task. If you need a top-level task, the user must create it from the foreground chat.";
            }

            // Resolve the agent-supplied parent displayId to its UUID once;
            // downstream code paths all expect UUIDs.
            let resolvedParentId: string | undefined;
            if (parentTaskId) {
              const resolved = await resolve("Parent task", parentTaskId);
              if (typeof resolved !== "string") return resolved.error;
              resolvedParentId = resolved;
            }

            // Follow-up: reschedule the parent task
            if (isFollowUp && resolvedParentId) {
              const parentTask = await getTaskById(resolvedParentId);
              if (!parentTask) return "Parent task not found.";

              if (!schedule) return "Schedule is required for follow-up.";

              const tz = timezone ?? "UTC";
              const followUpNextRun = computeNextRun(schedule, tz);
              if (!followUpNextRun) return "Could not compute follow-up time.";

              await rescheduleTaskAt(
                resolvedParentId,
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
                parentTaskId: resolvedParentId ?? null,
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

              return `Created scheduled task: "${title}" (ID: ${task.displayId ?? task.id}).${nextRunInfo}${limitInfo}`;
            }

            // Immediate task (no scheduling).
            //
            // Agent-created tasks default to Ready: the wake-up handler
            // runs them after a brief editing buffer (the user's editing
            // window). Todo is the backlog state — only reached when the
            // agent or user explicitly parks the task; it does not auto-
            // schedule a buffer. Subtasks behave the same way — they run
            // in parallel with siblings under their own Ready buffers.
            const resolvedStatus = (initialStatus ?? "Ready") as TaskStatus;

            const task = await createTask(
              workspaceId,
              userId,
              title,
              undefined,
              {
                actor: "agent",
                status: resolvedStatus,
                ...(resolvedParentId && { parentTaskId: resolvedParentId }),
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
            const label = resolvedParentId ? "subtask" : "task";
            const targetStatus = resolvedStatus;
            const statusNote =
              targetStatus === "Waiting"
                ? "Waiting — send_message to user explaining what's needed. Once unblocked, the task executes in its own thread; do not do its work in the current conversation."
                : resolvedParentId
                  ? `Added to ${targetStatus}. The subtask runs its own execute cycle through its own editing buffer, in parallel with siblings. Do NOT do its work in the current conversation; just acknowledge creation and continue with the parent or stop.`
                  : `Added to ${targetStatus}. The task will be picked up and executed in its own thread — do NOT do its work in the current conversation; just acknowledge creation and stop.`;
            logger.info(
              `Task ${task.id} created (${targetStatus})${resolvedParentId ? ` subtask of ${resolvedParentId}` : ""}`,
            );
            return `${label} created: "${title}" (ID: ${task.displayId ?? task.id}). ${statusNote} Link: ${env.APP_ORIGIN}/home/tasks?taskId=${task.id}`;
          } catch (error) {
            logger.error("Failed to create task", { error });
            return `Failed to create task: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
    }),

    get_task: tool({
      description: `Get full details of a task including its complete description. Use before updating a task so you can see what's already there and merge new context into it.`,
      inputSchema: z.object({
        taskId: z
          .string()
          .describe("The task displayId (e.g. tk-abcde or tk-abcde.1)"),
      }),
      execute: async ({ taskId }) => {
        try {
          const resolved = await resolve("Task", taskId);
          if (typeof resolved !== "string") return resolved.error;

          const task = await getTaskById(resolved);
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
            `ID: ${task.displayId ?? task.id}`,
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
        "List tasks with their current status. Use type filter to see scheduled/recurring tasks separately. Date filters narrow by createdAt (when the task was created) or dueAt (when a scheduled task next fires). All dates are ISO 8601 (YYYY-MM-DD or full ISO datetime). Use this to find tasks by topic — there is no keyword search; list all and pick the matching one yourself.",
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
        createdAfter: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date — only return tasks created on or after this date (e.g. '2026-05-01').",
          ),
        createdBefore: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date — only return tasks created on or before this date.",
          ),
        dueAfter: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date — only return tasks scheduled to fire on or after this date (applies to scheduled/recurring tasks via nextRunAt).",
          ),
        dueBefore: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date — only return tasks scheduled to fire on or before this date.",
          ),
      }),
      execute: async ({
        status,
        type,
        createdAfter,
        createdBefore,
        dueAfter,
        dueBefore,
      }) => {
        try {
          const parseDate = (input: string | undefined): Date | undefined => {
            if (!input) return undefined;
            const d = new Date(input);
            return Number.isNaN(d.getTime()) ? undefined : d;
          };
          const dateOpts = {
            createdAfter: parseDate(createdAfter),
            createdBefore: parseDate(createdBefore),
            dueAfter: parseDate(dueAfter),
            dueBefore: parseDate(dueBefore),
          };

          let tasks;

          if (type === "scheduled" || type === "recurring") {
            tasks = await getScheduledTasksForWorkspace(workspaceId, dateOpts);
            if (type === "recurring") {
              tasks = tasks.filter(
                (t) =>
                  t.schedule && (!t.maxOccurrences || t.maxOccurrences > 1),
              );
            } else {
              tasks = tasks.filter((t) => t.maxOccurrences === 1);
            }
          } else if (type === "immediate") {
            tasks = await getTasks(workspaceId, {
              status: status as TaskStatus | undefined,
              ...dateOpts,
            });
            tasks = tasks.filter((t) => !t.schedule && !t.nextRunAt);
          } else {
            tasks = await getTasks(workspaceId, {
              status: status as TaskStatus | undefined,
              ...dateOpts,
            });
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
              info += ` (ID: ${t.displayId ?? t.id})`;
              return info;
            }),
          );
          return lines.join("\n");
        } catch (error) {
          return "Failed to list tasks.";
        }
      },
    }),

    update_task: tool({
      description: `Update an existing task — change its status, title, description, scheduling, or parent.

DESCRIPTION CONTENT (the task body the user reads):

The description has three structured zones the agent owns. Pass HTML in the \`description\` parameter containing one or more of these tags:

- <plan>...</plan> — the current plan or step-by-step approach. REPLACE semantics: each write overwrites the zone.
- <outcome>...</outcome> — the result the user reads when the work is done. REPLACE semantics: each write overwrites the zone.
- <log>...</log> — rolling per-run data (e.g. a daily recurring task accumulating entries through the week). APPEND semantics: each write's children are concatenated onto the existing log.

Strict input contract: at most ONE of each tag per call. Multiple of any one type returns an error and the description is not updated. To touch more than one zone at once, send HTML containing all the tags in a single call.

Anything outside these tags is silently dropped — the user's prose elsewhere on the page is sacred and never modified by this tool. Do NOT use the description for status updates, error logs, or transient state; status updates go via send_message.

BACKGROUND / SCHEDULED EXECUTION: when this turn is a scheduled-fire or background run (not a live chat with the user), the tool will REJECT <plan> and <outcome> writes. Only <log> and \`clearLog\` are allowed — the plan is frozen until the user is back in the loop. Use <log> for per-run data; if the recurring runbook says "send and clear" at a boundary, set \`clearLog: true\` to wipe the log after delivery.

REPARENTING: Pass newParentId to move a task under a different parent (or null to make it a root task). This deletes the task and recreates it under the new parent — the task gets a new displayId. Subtasks are also deleted.`,
      inputSchema: z.object({
        taskId: z
          .string()
          .describe("The task displayId (e.g. tk-abcde or tk-abcde.1)"),
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
            "Task description as HTML — provide <plan>...</plan>, <outcome>...</outcome>, and/or <log>...</log> tags to upsert those sections. At most one of each per call. <plan>/<outcome> replace; <log> appends. Other content is dropped. On background/scheduled runs, <plan> and <outcome> are rejected — use <log> only.",
          ),
        replaceDescription: z
          .boolean()
          .optional()
          .describe(
            "Set true to replace the entire description verbatim (only valid for task creation flows where the agent writes the user's prose from a brief). Default: false — description is merged via <plan>/<outcome>/<log> upsert. Rejected on background/scheduled runs.",
          ),
        clearLog: z
          .boolean()
          .optional()
          .describe(
            "Set true to wipe the <log> zone only (leaves <plan>, <outcome>, and the user's prose untouched). Use at the end of a recurring cycle (e.g. weekly send → clear). Allowed on background/scheduled runs.",
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
            "Move task under a new parent (displayId, e.g. tk-abcde). Deletes and recreates the task with a new displayId. Omit if not reparenting.",
          ),
      }),
      execute: async ({
        taskId,
        status,
        title,
        description,
        replaceDescription,
        clearLog,
        schedule,
        isActive,
        maxOccurrences,
        endDate,
        channel: updateChannel,
        newParentId,
      }) => {
        try {
          const resolvedTaskId = await resolve("Task", taskId);
          if (typeof resolvedTaskId !== "string") return resolvedTaskId.error;

          // Reparent: delete + recreate under new parent (requires a non-null string)
          if (typeof newParentId === "string") {
            const resolvedNewParent = await resolve("New parent", newParentId);
            if (typeof resolvedNewParent !== "string")
              return resolvedNewParent.error;
            const newTask = await reparentTask(
              resolvedTaskId,
              resolvedNewParent,
              workspaceId,
              userId,
            );
            return `Task reparented. New displayId: ${(newTask as { displayId?: string | null }).displayId ?? "pending"}.`;
          }

          // Fetch task once for recurring check and reuse
          const currentTask = await getTaskById(resolvedTaskId);
          const isRecurring = !!currentTask?.schedule;

          // BACKGROUND GUARD: when this turn is a scheduled-fire or background
          // run, the plan is frozen — only <log> writes (and clearLog) are
          // allowed. Reject <plan>/<outcome> writes and replaceDescription
          // before they touch the page. <log>-only descriptions still pass.
          if (isBackgroundExecution) {
            if (replaceDescription) {
              return `Description update rejected: replaceDescription is not allowed on background/scheduled runs. The plan is frozen until the user is in the loop. Use <log>...</log> for per-run data, or omit description entirely.`;
            }
            if (description !== undefined) {
              const hasPlanOrOutcome = /<(plan|outcome|output)\b/i.test(
                description,
              );
              if (hasPlanOrOutcome) {
                return `Description update rejected: <plan> and <outcome> writes are not allowed on background/scheduled runs. The plan is frozen until the user is in the loop. Use <log>...</log> for per-run data; if the runbook says to clear at a cycle boundary, pass clearLog: true.`;
              }
            }
          }

          // Description updates go through the same safeguards regardless of
          // whether scheduling fields are also being changed — never let the
          // scheduling branch wholesale-replace the page.
          if (description !== undefined && currentTask?.pageId) {
            if (replaceDescription) {
              const existingHtml =
                (await getPageContentAsHtml(currentTask.pageId)) ?? "";
              if (existingHtml.length > 0) {
                const similarity = textSimilarity(existingHtml, description);
                if (similarity < 0.3) {
                  return `Description update rejected: the new content is too different from the existing description (similarity: ${Math.round(similarity * 100)}%). Omit replaceDescription and pass <plan>/<outcome>/<log> tags to upsert sections instead.`;
                }
              }
              await setPageContentFromHtml(currentTask.pageId, description);
            } else {
              try {
                await upsertPageSection(currentTask.pageId, description);
              } catch (err) {
                return `Description update failed: ${err instanceof Error ? err.message : String(err)}`;
              }
            }
          }

          // Handle scheduling updates (description handled above)
          if (
            schedule !== undefined ||
            isActive !== undefined ||
            maxOccurrences !== undefined ||
            endDate !== undefined ||
            updateChannel !== undefined
          ) {
            // Scheduling fields and description go through different code paths
            // — updateScheduledTask handles scheduling, while description must
            // route through upsertPageSection (the zone-aware merger) so we
            // don't wholesale-replace the page and obliterate <plan>.
            await updateScheduledTask(resolvedTaskId, workspaceId, {
              title,
              schedule,
              channel: updateChannel,
              isActive,
              maxOccurrences: maxOccurrences ?? undefined,
              endDate: endDate ? new Date(endDate) : undefined,
            });
          } else if (title) {
            await updateTask(resolvedTaskId, { title }, false);
          }

          // Clear the rolling <log> zone, if requested. Runs after description
          // upsert so a single call can append a final log entry, deliver via
          // send_message elsewhere, then wipe — though typical usage is one or
          // the other.
          if (clearLog && currentTask?.pageId) {
            await clearPageSection(currentTask.pageId, "log");
          }

          if (status) {
            if (isRecurring) {
              // Recurring tasks: schema only allows Waiting | Review, so no
              // Done-to-Review mapping is needed here.
              try {
                await changeTaskStatus(
                  resolvedTaskId,
                  status as TaskStatus,
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
                  resolvedTaskId,
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
          if (description !== undefined) parts.push(`description updated`);
          if (clearLog) parts.push(`log cleared`);
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
        description: `Approve a Waiting task so execution can resume. Requires a reason explaining why the wait is resolved. The reason is appended to the task's conversation as the user's reply, and the task is enqueued immediately — the agent picks it up on its next turn and decides the new status itself. The task's status and phase are left untouched, so a task that went Waiting from PLAN mind resumes in plan mind. Only works on tasks currently in Waiting status.`,
        inputSchema: z.object({
          taskId: z
            .string()
            .describe("The displayId of the waiting task (e.g. tk-abcde)"),
          reason: z
            .string()
            .describe(
              "Why the wait is resolved — added to the task conversation as your reply so the agent resumes from there.",
            ),
        }),
        execute: async ({ taskId, reason }) => {
          try {
            const resolved = await resolve("Task", taskId);
            if (typeof resolved !== "string") return resolved.error;

            const task = await getTaskById(resolved);
            if (!task) return `Task ${taskId} not found.`;
            if (task.status !== "Waiting")
              return `Task is not Waiting (current status: ${task.status}). Only Waiting tasks can be approved.`;

            // Resolve the most recent conversation tied to this task, or
            // create a new one if none exists. Then insert the reason as a
            // userType: User row so the agent's next turn picks it up like
            // a normal user reply and resumes the conversation.
            let conversationId: string | null =
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

            // Enqueue the task right away — don't touch its status. The
            // worker will flip it to Working via markTaskInProcess when it
            // picks the job up, and the agent decides where to go next
            // (Waiting / Review) from there. Phase metadata is preserved
            // because we never call changeTaskStatus.
            await enqueueTask({ taskId: resolved, workspaceId, userId });
            return `Task "${task.title}" unblocked and resumed in its own conversation. Tell the user it's being worked on. Do NOT take any further action on this task — it handles itself from here.`;
          } catch (error) {
            return `Failed to unblock task: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      }),
    }),

    // enter_plan_mode / exit_plan_mode — phase toggle on the current task.
    // Both are always registered when a task is in scope; the tool body is
    // idempotent (no-op when called in the matching phase). The agent flips
    // mind WITHIN the same turn — there's no forced turn boundary. The
    // current turn's prompt still reflects the pre-flip phase, but the
    // tool's response message tells the agent to adopt the new mental
    // model immediately. The next prompt build (next user message, next
    // scheduled wake-up, or an explicit reschedule_self / update_task)
    // will render the matching block.
    ...(currentTaskId && {
      enter_plan_mode: tool({
        description: `Switch this task into PLAN mind. Call when you can't execute yet because the goal is ambiguous, the shape is undefined, you need to gather information, or the work is open-ended and needs to be sketched out first.

Plan mind is for gathering info, loading readiness skills (Gather Information / Brainstorm / Plan / Decompose Task), and writing a plan into the task description via update_task with <plan>...</plan> HTML. When the plan is ready, call exit_plan_mode and act on it.

The task's status does NOT change — only the phase metadata. You can continue working in the same turn after this call.`,
        inputSchema: z.object({
          reason: z
            .string()
            .describe(
              "Why you can't execute yet — what gap plan mind needs to close (e.g. 'goal is open-ended, need to brainstorm shape', 'need to gather code structure before I can fix this', 'description names entities I don't recognize').",
            ),
        }),
        execute: async ({ reason }) => {
          try {
            const task = await getTaskById(currentTaskId);
            if (!task) return `Task ${currentTaskId} not found.`;

            const currentPhase = getTaskPhase(task);
            if (currentPhase === "prep") {
              return "Already in PLAN mind. Continue planning, or call exit_plan_mode when ready.";
            }

            await prisma.task.update({
              where: { id: currentTaskId },
              data: {
                metadata: setTaskPhaseInMetadata(
                  task.metadata,
                  "prep",
                ) as Prisma.InputJsonValue,
              },
            });

            logger.info(
              `Task ${currentTaskId} entered PLAN mind: ${reason}`,
            );

            return `Now in PLAN mind. Reason recorded: "${reason}". Continue in this turn: load the readiness skill that fits the gap, gather context, write your plan into the description with <plan>...</plan> HTML via update_task, then call exit_plan_mode and act on the plan.`;
          } catch (error) {
            logger.error("Failed to enter plan mode", { error });
            return `Failed to enter plan mode: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      }),

      exit_plan_mode: tool({
        description: `Switch this task back to EXECUTE mind. Call after you've written the plan into the task description and you're ready to act on it. You can continue working in the same turn — the next prompt build will render the execute block.

The task's status does NOT change. If your plan involves splitting into subtasks, do that AFTER exit_plan_mode. If you need user approval before executing the plan, call update_task(status: "Waiting") + send_message FIRST.`,
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const task = await getTaskById(currentTaskId);
            if (!task) return `Task ${currentTaskId} not found.`;

            const currentPhase = getTaskPhase(task);
            if (currentPhase === "execute") {
              return "Already in EXECUTE mind. Continue executing.";
            }

            await prisma.task.update({
              where: { id: currentTaskId },
              data: {
                metadata: setTaskPhaseInMetadata(
                  task.metadata,
                  "execute",
                ) as Prisma.InputJsonValue,
              },
            });

            logger.info(`Task ${currentTaskId} exited PLAN mind`);

            return "Now in EXECUTE mind. Continue in this turn: act on the plan you wrote into the description.";
          } catch (error) {
            logger.error("Failed to exit plan mode", { error });
            return `Failed to exit plan mode: ${error instanceof Error ? error.message : "Unknown error"}`;
          }
        },
      }),
    }),

    delete_task: tool({
      description:
        "Delete a task permanently. Use when user wants to cancel a task or scheduled item.",
      inputSchema: z.object({
        taskId: z
          .string()
          .describe("The displayId of the task to delete (e.g. tk-abcde)"),
      }),
      execute: async ({ taskId }) => {
        try {
          const resolved = await resolve("Task", taskId);
          if (typeof resolved !== "string") return resolved.error;
          await deleteTask(resolved, workspaceId);
          return "Task deleted.";
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to delete task";
        }
      },
    }),

    get_task_tree: tool({
      description: `Get the full ancestor chain for a task, from root down to the task itself. Use this to understand the hierarchy context — e.g. which epic/parent a task belongs to. Returns each ancestor's displayId and title in order.`,
      inputSchema: z.object({
        taskId: z
          .string()
          .describe(
            "The displayId of the task to get the tree for (e.g. tk-abcde)",
          ),
      }),
      execute: async ({ taskId }) => {
        try {
          const resolved = await resolve("Task", taskId);
          if (typeof resolved !== "string") return resolved.error;
          const tree = await getTaskTree(resolved);
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
