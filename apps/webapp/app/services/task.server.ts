import { prisma } from "~/db.server";
import type { Task, TaskStatus } from "@prisma/client";
import { findOrCreateTaskPage } from "~/services/page.server";
import {
  cancelTaskJob,
  removeScheduledTask,
  enqueueScheduledTask,
} from "~/lib/queue-adapter.server";
import {
  computeNextRun,
  checkShouldDeactivate,
  formatScheduleForUser,
} from "~/utils/schedule-utils";
import { DateTime } from "luxon";
import { logger } from "./logger.service";
import {
  setPageContentFromHtml,
  getPageContentAsHtml,
} from "~/services/hocuspocus/content.server";
import { updateTaskTitleInPages } from "~/services/hocuspocus/page-outlinks.server";
import {
  canTransition,
  type TransitionActor,
} from "~/services/task.phase";

// ============================================================================
// Interfaces
// ============================================================================

export interface ScheduledTaskData {
  title: string;
  description?: string;
  schedule?: string; // RRule string (in user's local timezone)
  nextRunAt?: Date; // For one-time scheduled tasks (computed if schedule provided)
  channel?: string; // Channel name or type
  channelId?: string | null; // FK to Channel table
  maxOccurrences?: number | null;
  endDate?: Date | null;
  startDate?: Date | null;
  parentTaskId?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string;
}

export interface ScheduledTaskUpdateData {
  title?: string;
  description?: string;
  schedule?: string;
  channel?: string;
  channelId?: string | null;
  isActive?: boolean;
  maxOccurrences?: number | null;
  endDate?: Date | null;
}

// ============================================================================
// Basic Task CRUD (existing)
// ============================================================================

export async function createTask(
  workspaceId: string,
  userId: string,
  title: string,
  description?: string,
  options?: {
    source?: string;
    status?: TaskStatus;
    parentTaskId?: string;
    actor?: TransitionActor;
  },
): Promise<Task> {
  // Enforce max depth: epic → task → sub-task (no further nesting).
  // A sub-task's displayId has 2 dots (e.g. tk-zshue.1.1), so if the parent
  // already has 2+ dots we drop parentTaskId to prevent a 4th level.
  let resolvedParentTaskId = options?.parentTaskId;
  if (resolvedParentTaskId) {
    const parent = await prisma.task.findUnique({
      where: { id: resolvedParentTaskId },
      select: { displayId: true },
    });
    const dots = (parent?.displayId?.match(/\./g) ?? []).length;
    if (dots >= 2) {
      throw new Error(
        "Task depth limit reached: max 2 levels (epic → task → sub-task)",
      );
    }
  }

  const effectiveStatus = options?.status ?? "Todo";

  // Execute-first lifecycle: every new task starts in execute mind. We do
  // NOT write metadata.phase at creation — the absence of phase IS execute
  // (see getTaskPhase). Only enter_plan_mode writes metadata.phase = "prep"
  // when the agent self-promotes; exit_plan_mode flips it back to execute.
  const task = await prisma.task.create({
    data: {
      title,
      status: effectiveStatus,
      workspaceId,
      userId,
      ...(options?.source && { source: options.source }),
      ...(resolvedParentTaskId && { parentTaskId: resolvedParentTaskId }),
    },
  });

  const page = await findOrCreateTaskPage(workspaceId, userId, task.id);
  if (description) {
    await setPageContentFromHtml(page.id, description);
  }

  // Buffer wake-up: a freshly-created Ready task sits for 2 minutes so the
  // user can edit before execution starts. At expiry, the scheduled-task
  // wake-up handler enqueues the task for the runner.
  //
  // Other statuses skip the buffer:
  //   - Todo = backlog. The task sits idle until promoted to Ready (which
  //     applies the buffer through the changeTaskStatus path).
  //   - Waiting = gated on user input via send_message; should not auto-run.
  // Scheduled/recurring tasks use createScheduledTask and skip this buffer.
  if (effectiveStatus === "Ready") {
    const nextRunAt = new Date(Date.now() + 2 * 60 * 1000);
    await prisma.task.update({
      where: { id: task.id },
      data: { nextRunAt },
    });
    try {
      await enqueueScheduledTask(
        {
          taskId: task.id,
          workspaceId,
          userId,
          channel: task.channel ?? "email",
        },
        nextRunAt,
      );
    } catch (err) {
      logger.warn("Failed to enqueue buffer wake-up for new task", {
        err,
        taskId: task.id,
        status: effectiveStatus,
      });
    }
  }

  return prisma.task.findUniqueOrThrow({ where: { id: task.id } });
}

export async function getTaskById(id: string): Promise<Task | null> {
  return prisma.task.findUnique({ where: { id } });
}

/**
 * Resolve a user-facing task identifier to its internal UUID.
 *
 * Accepts either a UUID (passed through after a workspace-scoped existence
 * check) or a `tk-…` displayId (looked up via the `(workspaceId, displayId)`
 * unique index). Returns null if no task in this workspace matches.
 *
 * Agent tools take displayIds from the model and call this at the boundary;
 * everything downstream keeps working with UUIDs.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveTaskId(
  input: string,
  workspaceId: string,
): Promise<string | null> {
  if (!input) return null;
  if (UUID_RE.test(input)) {
    const task = await prisma.task.findFirst({
      where: { id: input, workspaceId },
      select: { id: true },
    });
    return task?.id ?? null;
  }
  const task = await prisma.task.findUnique({
    where: { workspaceId_displayId: { workspaceId, displayId: input } },
    select: { id: true },
  });
  return task?.id ?? null;
}

export type TaskWithRelations = Task & {
  subtasks: Pick<Task, "id" | "status" | "source">[];
  parentTask: Pick<Task, "id" | "title"> | null;
};

export type TaskFull = Task & {
  subtasks: Task[];
  parentTask: Pick<Task, "id" | "title" | "displayId"> | null;
};

export async function getTaskFull(
  id: string,
  workspaceId: string,
): Promise<TaskFull | null> {
  return prisma.task.findFirst({
    where: { id, workspaceId },
    include: {
      subtasks: { orderBy: { createdAt: "asc" } },
      parentTask: { select: { id: true, title: true, displayId: true } },
    },
  }) as Promise<TaskFull | null>;
}

export async function getTasks(
  workspaceId: string,
  options?: {
    status?: TaskStatus;
    isScheduled?: boolean;
    createdAfter?: Date;
    createdBefore?: Date;
    dueAfter?: Date;
    dueBefore?: Date;
  },
): Promise<TaskWithRelations[]> {
  const {
    status,
    isScheduled,
    createdAfter,
    createdBefore,
    dueAfter,
    dueBefore,
  } = options ?? {};

  const scheduledFilter =
    isScheduled === true
      ? {
          isActive: true,
          OR: [
            { schedule: { not: null as null } },
            { nextRunAt: { not: null as null } },
          ],
        }
      : isScheduled === false
        ? {
            AND: [{ schedule: null as null }, { nextRunAt: null as null }],
          }
        : {};

  const createdAtFilter =
    createdAfter || createdBefore
      ? {
          createdAt: {
            ...(createdAfter && { gte: createdAfter }),
            ...(createdBefore && { lte: createdBefore }),
          },
        }
      : {};

  const dueAtFilter =
    dueAfter || dueBefore
      ? {
          nextRunAt: {
            ...(dueAfter && { gte: dueAfter }),
            ...(dueBefore && { lte: dueBefore }),
          },
        }
      : {};

  return prisma.task.findMany({
    where: {
      workspaceId,
      ...(status && { status }),
      ...scheduledFilter,
      ...createdAtFilter,
      ...dueAtFilter,
    },
    orderBy: { createdAt: "desc" },
    include: {
      subtasks: { select: { id: true, status: true, source: true } },
      parentTask: { select: { id: true, title: true } },
    },
  }) as Promise<TaskWithRelations[]>;
}

export { searchTasks } from "~/services/tasks/search.server";

export async function updateTask(
  id: string,
  data: {
    status?: TaskStatus;
    title?: string;
    description?: string;
    channel?: string | null;
    channelId?: string | null;
    /** Page the change originated from — excluded from title propagation. */
    sourcePageId?: string;
  },
  /** When true, appends description to existing content instead of replacing */
  append = false,
): Promise<Task> {
  const { description, sourcePageId, ...prismaData } = data;

  const existing = data.title
    ? await prisma.task.findUnique({ where: { id }, select: { title: true } })
    : null;
  const task = await prisma.task.update({ where: { id }, data: prismaData });

  // Propagate title change to all pages that reference this task
  if (data.title && data.title !== existing?.title) {
    updateTaskTitleInPages(id, data.title, sourcePageId).catch(console.error);
  }

  if (description && task.pageId) {
    if (append) {
      const existing = (await getPageContentAsHtml(task.pageId)) ?? "";
      const merged = existing ? `${existing}${description}` : description;
      await setPageContentFromHtml(task.pageId, merged);
    } else {
      await setPageContentFromHtml(task.pageId, description);
    }
  }

  return task;
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { status } });
}

/**
 * Central lifecycle handler for task status changes.
 * - Cancels any queued/executing job when moving away from InProgress
 * - Cancels scheduled jobs when deactivating
 * - Parallel subtask execution: subtasks default Ready and run independently;
 *   parent auto-Dones when all subtasks are no longer active
 */
export async function changeTaskStatus(
  taskId: string,
  status: TaskStatus,
  workspaceId: string,
  userId: string,
  actor: TransitionActor = "agent",
): Promise<Task> {
  const current = await prisma.task.findUnique({ where: { id: taskId } });
  if (!current) throw new Error(`Task ${taskId} not found`);

  if (!canTransition(current.status, status, actor)) {
    throw new Error(
      `Invalid transition: ${current.status} -> ${status} by ${actor}`,
    );
  }

  // Canonical wake-up rule for non-scheduled tasks:
  //   - Moving to Todo / Waiting / Review parks the task. Clear nextRunAt
  //     and cancel any pending wake-up so an old buffer doesn't fire late.
  //   - Moving to Ready with an existing pending wake-up leaves it alone
  //     (let it fire on its original schedule).
  //   - Otherwise moving to Ready gives a 2-minute editing buffer.
  // Scheduled/recurring tasks own their own nextRunAt via
  // scheduleNextTaskOccurrence — we never touch it from here.
  if (status === "Todo" || status === "Waiting" || status === "Review") {
    await cancelTaskJob(taskId);
    if (!current.schedule && current.nextRunAt) {
      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: { nextRunAt: null },
      });
    }
  }

  if (status === "Ready" && !current.schedule) {
    if (current.nextRunAt) {
      // A wake-up is already pending — let it fire at its scheduled time
      // instead of cancelling it and resetting the 2-min buffer.
    } else {
      // Fresh Ready transition: give the user a 2-min editing buffer
      // before execution starts.
      const nextRunAt = new Date(Date.now() + 2 * 60 * 1000);
      await prisma.task.update({
        where: { id: taskId },
        data: { nextRunAt },
      });
      try {
        await enqueueScheduledTask(
          { taskId, workspaceId, userId, channel: current.channel ?? "email" },
          nextRunAt,
        );
      } catch (err) {
        logger.warn("Failed to enqueue 2-min Ready buffer wake-up", {
          err,
          taskId,
        });
      }
    }
  }

  // Subtask Done — auto-complete parent if no siblings are still active.
  // In the parallel model there is no "next sibling" to kick off; subtasks
  // run independently and the parent flips to Done once every child has
  // reached its terminal state. Review counts as non-terminal because the
  // user still has to move Review → Done — if we treated Review as finished
  // here, the parent could auto-Done while a sibling is still awaiting
  // user verification.
  if (status === "Done" && current.parentTaskId) {
    const activeSiblings = await prisma.task.count({
      where: {
        parentTaskId: current.parentTaskId,
        id: { not: taskId },
        status: { in: ["Todo", "Working", "Waiting", "Ready", "Review"] },
      },
    });
    if (activeSiblings === 0) {
      // Parent auto-completion is a system-on-behalf-of-user transition.
      await changeTaskStatus(
        current.parentTaskId,
        "Done",
        workspaceId,
        userId,
        "user",
      );
    }
  }

  // If moving a recurring/scheduled task to Done, deactivate scheduling.
  // Waiting does NOT deactivate — the schedule is the user's intent and should
  // keep ticking. If the user doesn't unblock, the task still fires at the scheduled time.
  if (status === "Done") {
    if (current.nextRunAt || current.schedule) {
      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: { isActive: false, nextRunAt: null },
      });
    }
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status },
  });

  // Clear any unread voice inbox rows that belong to this task once it's
  // resolved. Two trigger conditions:
  //   - status moved to Done (task is finished, no need to nag)
  //   - status moved out of Waiting (the blocker was acknowledged)
  // The pill should stop showing stale "task is waiting on you" updates after
  // the user acts.
  const shouldClearInbox =
    status === "Done" ||
    (current.status === "Waiting" && status !== "Waiting");
  if (shouldClearInbox) {
    try {
      const cleared = await prisma.voiceInboxMessage.updateMany({
        where: { taskId, checked: null },
        data: { checked: new Date() },
      });
      if (cleared.count > 0) {
        logger.info(
          `Auto-checked ${cleared.count} voice inbox row(s) for task ${taskId} (${current.status} -> ${status})`,
        );
      }
    } catch (err) {
      logger.warn("Failed to auto-check voice inbox rows on status change", {
        err,
        taskId,
        from: current.status,
        to: status,
      });
    }
  }

  return task;
}

export async function updateTaskConversationIds(
  id: string,
  conversationIds: string[],
): Promise<Task> {
  return prisma.task.update({ where: { id }, data: { conversationIds } });
}

export async function markTaskInProcess(
  id: string,
  jobId?: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: {
      status: "Working",
      ...(jobId && { jobId }),
    },
  });
}

export async function markTaskCompleted(
  id: string,
  result: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: {
      status: "Review",
      result,
    },
  });
}

export async function markTaskFailed(id: string, error: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id } });

  if (task?.pageId) {
    const existingHtml = (await getPageContentAsHtml(task.pageId)) ?? "";
    const errorEntry = `<p>[Error] ${new Date().toISOString()}: ${error}</p>`;
    await setPageContentFromHtml(task.pageId, existingHtml + errorEntry);
  }

  return prisma.task.update({
    where: { id },
    data: { status: "Waiting", error },
  });
}

export type TaskAncestor = {
  id: string;
  displayId: string | null;
  title: string;
};

/**
 * Walk up the parent chain from a task to the root.
 * Returns ancestors ordered root → ... → immediate parent → task itself.
 */
export async function getTaskTree(taskId: string): Promise<TaskAncestor[]> {
  const ancestors: TaskAncestor[] = [];
  let currentId: string | null = taskId;

  while (currentId) {
    const task: {
      id: string;
      displayId: string | null;
      title: string;
      parentTaskId: string | null;
    } | null = await prisma.task.findUnique({
      where: { id: currentId },
      select: { id: true, displayId: true, title: true, parentTaskId: true },
    });
    if (!task) break;
    ancestors.unshift({
      id: task.id,
      displayId: (task as { displayId?: string | null }).displayId ?? null,
      title: task.title,
    });
    currentId = task.parentTaskId ?? null;
  }

  return ancestors;
}

/**
 * Reparent a task: delete it (cascades subtasks) and recreate under newParentId.
 * Copies title, status, source, and description to the new task.
 */
export async function reparentTask(
  taskId: string,
  newParentId: string | null,
  workspaceId: string,
  userId: string,
): Promise<Task> {
  const original = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
  });
  if (!original) throw new Error(`Task ${taskId} not found`);

  // Capture page content before deletion
  let pageHtml: string | undefined;
  if (original.pageId) {
    pageHtml = (await getPageContentAsHtml(original.pageId)) ?? undefined;
  }

  // Delete original — cascades to subtasks
  await deleteTask(taskId, workspaceId);

  // Recreate under new parent (trigger assigns fresh displayId)
  const newTask = await createTask(
    workspaceId,
    userId,
    original.title,
    undefined,
    {
      source: original.source,
      status: original.status,
      parentTaskId: newParentId ?? undefined,
    },
  );

  // Restore description if any
  if (pageHtml && newTask.pageId) {
    await setPageContentFromHtml(newTask.pageId, pageHtml);
  }

  return newTask;
}

export async function deleteTask(
  id: string,
  workspaceId: string,
): Promise<Task> {
  const task = await prisma.task.findFirst({ where: { id, workspaceId } });
  if (!task) throw new Error(`Task ${id} not found`);

  // Cancel any scheduled/queued jobs
  if (task.nextRunAt || task.schedule) {
    await removeScheduledTask(id);
  }
  await cancelTaskJob(id);

  return prisma.task.delete({ where: { id } });
}

// ============================================================================
// Scheduled Task Functions (absorbed from reminder.server.ts)
// ============================================================================

/**
 * Create a scheduled task (replaces addReminder).
 * Schedule is stored as-is (in user's local timezone).
 * nextRunAt is computed and stored in UTC.
 */
export async function createScheduledTask(
  workspaceId: string,
  userId: string,
  data: ScheduledTaskData,
): Promise<Task> {
  // Get user's timezone
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { UserWorkspace: { include: { user: true }, take: 1 } },
  });
  const user = workspace?.UserWorkspace[0]?.user;
  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";

  // Determine the "after" time for computing next run
  let afterTime = new Date();
  if (data.startDate) {
    const startInUserTz = DateTime.fromJSDate(data.startDate)
      .setZone(timezone)
      .startOf("day");
    afterTime = startInUserTz.toJSDate();
  }

  // Compute nextRunAt
  let nextRunAt: Date | null = data.nextRunAt ?? null;
  if (!nextRunAt && data.schedule) {
    nextRunAt = computeNextRun(data.schedule, timezone, afterTime);
  }

  // Scheduled/recurring tasks land directly in Ready — execute mind is the
  // implicit default (absence of metadata.phase). The first execution
  // handles any clarification in the execution conversation.
  const status: TaskStatus = "Ready";

  const task = await prisma.task.create({
    data: {
      title: data.title,
      status,
      workspaceId,
      userId,
      schedule: data.schedule ?? null,
      nextRunAt,
      channel: data.channel ?? null,
      channelId: data.channelId ?? null,
      startDate: data.startDate ?? null,
      maxOccurrences: data.maxOccurrences ?? null,
      occurrenceCount: 0,
      endDate: data.endDate ?? null,
      parentTaskId: data.parentTaskId ?? null,
      isActive: true,
      source: data.source ?? "manual",
      ...(data.metadata && { metadata: data.metadata as never }),
    },
  });

  // Create page and set description content if provided
  const page = await findOrCreateTaskPage(workspaceId, userId, task.id);
  if (data.description) {
    await setPageContentFromHtml(page.id, data.description);
  }

  // Enqueue the scheduled job
  if (task.isActive && nextRunAt) {
    await enqueueScheduledTask(
      {
        taskId: task.id,
        workspaceId,
        userId,
        channel: task.channel ?? "email",
      },
      nextRunAt,
    );
  }

  logger.info(
    `Created scheduled task ${task.id} for workspace ${workspaceId}, next run: ${nextRunAt}`,
  );
  return task;
}

/**
 * Update a scheduled task's scheduling fields.
 */
export async function updateScheduledTask(
  taskId: string,
  workspaceId: string,
  data: ScheduledTaskUpdateData,
): Promise<Task> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    include: {
      workspace: {
        include: { UserWorkspace: { include: { user: true }, take: 1 } },
      },
    },
  });

  if (!existing) {
    throw new Error("Task not found or access denied");
  }

  const user = existing.workspace?.UserWorkspace[0]?.user;
  const userMeta = user?.metadata as Record<string, unknown> | null;
  const timezone = (userMeta?.timezone as string) ?? "UTC";

  // Use new schedule or keep existing
  const schedule = data.schedule ?? existing.schedule;

  // Compute new nextRunAt if schedule changed
  const nextRunAt = data.schedule
    ? computeNextRun(schedule!, timezone)
    : existing.nextRunAt;

  // When the schedule changes, regenerate metadata.scheduleText so the UI
  // label stays in sync with the new RRule. Clear it if the schedule was
  // cleared. Other updates leave metadata untouched.
  let metadataUpdate: Record<string, unknown> | undefined;
  if (data.schedule !== undefined) {
    const existingMeta =
      (existing.metadata as Record<string, unknown> | null) ?? {};
    if (schedule) {
      metadataUpdate = {
        ...existingMeta,
        scheduleText: formatScheduleForUser(schedule, timezone),
      };
    } else {
      const { scheduleText: _omitted, ...rest } = existingMeta as Record<
        string,
        unknown
      > & { scheduleText?: string };
      metadataUpdate = rest;
    }
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.schedule !== undefined && { schedule, nextRunAt }),
      ...(data.channel !== undefined && { channel: data.channel }),
      ...(data.channelId !== undefined && { channelId: data.channelId }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.maxOccurrences !== undefined && {
        maxOccurrences: data.maxOccurrences,
      }),
      ...(data.endDate !== undefined && { endDate: data.endDate }),
      ...(metadataUpdate !== undefined && {
        metadata: metadataUpdate as never,
      }),
    },
  });

  if (data.description !== undefined) {
    const page = await findOrCreateTaskPage(
      existing.workspaceId,
      existing.userId,
      taskId,
    );
    // Merge structured zones (<plan>/<outcome>/<log>) rather than wholesale
    // replace — wholesale replace here was the bug that let scheduling-field
    // updates obliterate the rest of the task body (including <plan>) on
    // recurring tasks.
    const { upsertPageSection } = await import("~/services/coding-task.server");
    await upsertPageSection(page.id, data.description);
  }

  // Only touch the queue when a scheduling-relevant field actually changed.
  // Title/description/channel edits must not cancel and re-enqueue the
  // pending wake-up — doing so on an in-flight occurrence (status=Working)
  // races with the running pipeline and can leave the task without any
  // future delayed run, stalling all subsequent occurrences.
  const scheduleChanged = data.schedule !== undefined;
  const activationChanged =
    data.isActive !== undefined && data.isActive !== existing.isActive;
  const limitsChanged =
    data.endDate !== undefined || data.maxOccurrences !== undefined;
  const queueShouldChange =
    scheduleChanged || activationChanged || limitsChanged;

  if (queueShouldChange) {
    await removeScheduledTask(taskId);
    if (task.isActive && task.nextRunAt) {
      await enqueueScheduledTask(
        {
          taskId: task.id,
          workspaceId,
          userId: existing.userId,
          channel: task.channel ?? "email",
        },
        task.nextRunAt,
      );
    }
  }

  logger.info(`Updated scheduled task ${task.id} for workspace ${workspaceId}`);
  return task;
}

/**
 * Schedule next occurrence for a recurring task.
 */
export async function scheduleNextTaskOccurrence(
  taskId: string,
): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      workspace: {
        include: { UserWorkspace: { include: { user: true }, take: 1 } },
      },
    },
  });

  if (!task || !task.isActive || !task.schedule) {
    return false;
  }

  const user = task.workspace?.UserWorkspace[0]?.user;
  const userMeta = user?.metadata as Record<string, unknown> | null;
  const timezone = (userMeta?.timezone as string) ?? "UTC";

  const nextRunAt = computeNextRun(task.schedule, timezone);

  if (!nextRunAt) {
    logger.info(`No more occurrences for task ${taskId}`);
    await deactivateScheduledTask(taskId);
    return false;
  }

  // Check if next run is past endDate
  if (task.endDate && nextRunAt > task.endDate) {
    logger.info(`Task ${taskId} past endDate, deactivating`);
    await deactivateScheduledTask(taskId);
    return false;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { nextRunAt },
  });

  // Loop Review/Working back to Ready for the next fire. Recurring tasks
  // never reach Done automatically — the user disables or deletes them to
  // stop the recurrence.
  if (task.status === "Review" || task.status === "Working") {
    try {
      await changeTaskStatus(
        taskId,
        "Ready",
        task.workspaceId,
        task.userId,
        "system",
      );
    } catch (err) {
      logger.warn("Failed to loop recurring task back to Ready", {
        err,
        taskId,
        fromStatus: task.status,
      });
    }
  }

  await enqueueScheduledTask(
    {
      taskId,
      workspaceId: task.workspaceId,
      userId: task.userId,
      channel: task.channel ?? "email",
    },
    nextRunAt,
  );

  logger.info(`Scheduled next occurrence for task ${taskId} at ${nextRunAt}`);
  return true;
}

/**
 * Increment occurrence count and check for auto-deactivation.
 */
export async function incrementTaskOccurrenceCount(
  taskId: string,
): Promise<{ task: Task; shouldDeactivate: boolean }> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      occurrenceCount: { increment: 1 },
      lastRunAt: new Date(),
    },
  });

  const shouldDeactivate = checkShouldDeactivate(task);

  if (shouldDeactivate) {
    await deactivateScheduledTask(taskId);
    logger.info(
      `Auto-deactivated task ${taskId} (occurrences: ${task.occurrenceCount}/${task.maxOccurrences})`,
    );
  }

  return { task, shouldDeactivate };
}

/**
 * Increment unresponded count for a scheduled task.
 */
export async function incrementTaskUnrespondedCount(
  taskId: string,
): Promise<Task> {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      unrespondedCount: { increment: 1 },
      lastRunAt: new Date(),
    },
  });
}

/**
 * Deactivate a scheduled task.
 */
export async function deactivateScheduledTask(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { isActive: false, nextRunAt: null },
  });

  await removeScheduledTask(taskId);
  logger.info(`Deactivated scheduled task ${taskId}`);
}

/**
 * Reschedule a task to fire at a specific time (for follow-ups).
 */
export async function rescheduleTaskAt(
  taskId: string,
  workspaceId: string,
  nextRunAt: Date,
): Promise<void> {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
  });

  if (!existing) {
    throw new Error("Task not found or access denied");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { nextRunAt, isActive: true },
  });

  await removeScheduledTask(taskId);
  await enqueueScheduledTask(
    {
      taskId,
      workspaceId,
      userId: existing.userId,
      channel: existing.channel ?? "email",
    },
    nextRunAt,
  );

  logger.info(
    `Rescheduled task ${taskId} for workspace ${workspaceId} at ${nextRunAt}`,
  );
}

/**
 * Get all active scheduled tasks for a workspace.
 */
export async function getScheduledTasksForWorkspace(
  workspaceId: string,
  options?: {
    createdAfter?: Date;
    createdBefore?: Date;
    dueAfter?: Date;
    dueBefore?: Date;
  },
): Promise<Task[]> {
  const { createdAfter, createdBefore, dueAfter, dueBefore } = options ?? {};

  // nextRunAt must be non-null AND fall inside the requested range when one
  // is provided. Combine both conditions into a single Prisma filter.
  const nextRunAtFilter: Record<string, unknown> = { not: null };
  if (dueAfter) nextRunAtFilter.gte = dueAfter;
  if (dueBefore) nextRunAtFilter.lte = dueBefore;

  const createdAtFilter =
    createdAfter || createdBefore
      ? {
          createdAt: {
            ...(createdAfter && { gte: createdAfter }),
            ...(createdBefore && { lte: createdBefore }),
          },
        }
      : {};

  return prisma.task.findMany({
    where: {
      workspaceId,
      isActive: true,
      nextRunAt: nextRunAtFilter,
      ...createdAtFilter,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all active scheduled tasks (for startup recovery).
 */
export async function getActiveScheduledTasks(): Promise<Task[]> {
  return prisma.task.findMany({
    where: { isActive: true, nextRunAt: { not: null } },
  });
}

/**
 * Recalculate all scheduled task nextRunAt when user's timezone changes.
 */
export async function recalculateTasksForTimezone(
  workspaceId: string,
  _oldTimezone: string,
  newTimezone: string,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  try {
    const tasks = await prisma.task.findMany({
      where: { workspaceId, isActive: true, schedule: { not: null } },
    });

    logger.info(
      `Recalculating ${tasks.length} scheduled tasks for timezone change to ${newTimezone}`,
    );

    for (const task of tasks) {
      try {
        if (!task.schedule) continue;

        const now = new Date();
        const nextRunAt = computeNextRun(task.schedule, newTimezone, now);

        // For one-time tasks, check if already passed
        const isOneTime = task.maxOccurrences === 1;

        if (isOneTime && (!nextRunAt || nextRunAt < now)) {
          await prisma.task.update({
            where: { id: task.id },
            data: { isActive: false, nextRunAt: null },
          });
          await removeScheduledTask(task.id);
          updated++;
          continue;
        }

        await prisma.task.update({
          where: { id: task.id },
          data: { nextRunAt },
        });

        await removeScheduledTask(task.id);
        if (nextRunAt) {
          await enqueueScheduledTask(
            {
              taskId: task.id,
              workspaceId,
              userId: task.userId,
              channel: task.channel ?? "email",
            },
            nextRunAt,
          );
        }

        updated++;
      } catch (error) {
        logger.error(`Failed to recalculate task ${task.id}`, { error });
        failed++;
      }
    }

    logger.info(
      `Timezone recalculation complete: ${updated} updated, ${failed} failed`,
    );
    return { updated, failed };
  } catch (error) {
    logger.error("Failed to recalculate tasks for timezone change", { error });
    return { updated, failed };
  }
}
