import { prisma } from "~/db.server";
import type { Task, TaskStatus } from "@prisma/client";
import { findOrCreateTaskPage } from "~/services/page.server";
import {
  cancelTaskJob,
  removeScheduledTask,
  enqueueScheduledTask,
  enqueueTask,
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
  getTaskPhase,
  inferNewPhase,
  setTaskPhaseInMetadata,
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
  // Agent-created Ready tasks (no schedule) are special: the agent already
  // classified them as simple+clear and skipped prep, but we still want a
  // 2-min buffer so the user can edit before execution. During the buffer
  // the task sits in Ready with phase=prep; the wake-up handler flips
  // phase to execute when it fires.
  const isAgentCreatedReady =
    effectiveStatus === "Ready" && options?.actor === "agent";
  // Initial phase: Todo or Waiting → prep (task needs planning),
  // agent-created Ready → prep (buffer hasn't fired yet),
  // everything else → execute (e.g., recurring tasks created in Ready
  // via createScheduledTask skip prep entirely).
  const initialPhase =
    effectiveStatus === "Todo" ||
    effectiveStatus === "Waiting" ||
    isAgentCreatedReady
      ? "prep"
      : "execute";

  const task = await prisma.task.create({
    data: {
      title,
      status: effectiveStatus,
      workspaceId,
      userId,
      metadata: setTaskPhaseInMetadata(null, initialPhase),
      ...(options?.source && { source: options.source }),
      ...(resolvedParentTaskId && { parentTaskId: resolvedParentTaskId }),
    },
  });

  const page = await findOrCreateTaskPage(workspaceId, userId, task.id);
  if (description) {
    await setPageContentFromHtml(page.id, description);
  }

  // Buffer wake-up: freshly-created tasks sit for 2 minutes so the user
  // can edit freely. At expiry, the scheduled-task wake-up handler starts
  // prep (Todo path) or directly enqueues execution (agent-created Ready
  // path, see scheduled-task.logic.ts isReadyBufferExpiry branch).
  // Two cases get the buffer:
  //   1. Anyone creates a Todo task (existing behavior — prep starts at expiry)
  //   2. Agent creates a Ready task with no schedule (new — execution starts
  //      at expiry; the agent already classified it as simple+clear and we
  //      record that decision via metadata.prepDecided=true so the prep
  //      invoker never re-enters prep for this task)
  // Scheduled/recurring tasks use createScheduledTask and skip this buffer.
  const needsBuffer = effectiveStatus === "Todo" || isAgentCreatedReady;

  if (needsBuffer) {
    const nextRunAt = new Date(Date.now() + 2 * 60 * 1000);
    await prisma.task.update({
      where: { id: task.id },
      data: {
        nextRunAt,
        // For agent-created Ready, mark prep decided. Phase stays "prep" —
        // the wake-up handler in scheduled-task.logic.ts will flip it to
        // "execute" when the buffer expires. The prepDecided flag is what
        // the prep invoker reads to short-circuit (Task 6).
        ...(isAgentCreatedReady && {
          metadata: setTaskPhaseInMetadata(
            {
              ...((task.metadata as Record<string, unknown>) ?? {}),
              prepDecided: true,
            },
            "prep",
          ),
        }),
      },
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
  options?: { status?: TaskStatus; isScheduled?: boolean },
): Promise<TaskWithRelations[]> {
  const { status, isScheduled } = options ?? {};

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

  return prisma.task.findMany({
    where: {
      workspaceId,
      ...(status && { status }),
      ...scheduledFilter,
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
 * Get the next Todo subtask for a parent, ordered by displayId.
 * Returns null if no Todo subtasks remain.
 */
export async function getNextBacklogSubtask(
  parentTaskId: string,
): Promise<Task | null> {
  return prisma.task.findFirst({
    where: { parentTaskId, status: "Waiting" },
    orderBy: { displayId: "asc" },
  });
}

/**
 * Central lifecycle handler for task status changes.
 * - Cancels any queued/executing job when moving away from InProgress
 * - Cancels scheduled jobs when deactivating
 * - Sequential subtask execution: parent Todo enqueues first subtask,
 *   subtask completion enqueues next sibling
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

  const currentPhase = getTaskPhase(current);
  if (!canTransition(current.status, status, currentPhase, actor)) {
    throw new Error(
      `Invalid transition: ${current.status} -> ${status} in phase ${currentPhase} by ${actor}`,
    );
  }

  const newPhase = inferNewPhase(current.status, status, currentPhase);
  const newMetadata = setTaskPhaseInMetadata(current.metadata, newPhase);

  if (status === "Todo" || status === "Waiting" || status === "Review") {
    await cancelTaskJob(taskId);
    // Also cancel any pending scheduled wake-up (e.g., the Todo 2-min buffer
    // wake-up, or a stale one-time scheduled fire). None of these states
    // should have a pending wake-up. Skip for recurring tasks — their
    // nextRunAt is owned by scheduleNextTaskOccurrence.
    if (!current.schedule && current.nextRunAt) {
      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: { nextRunAt: null },
      });
    }
  }

  // Unblock resume: when a task moves from Waiting → Todo (prep-phase unblock),
  // the original 2-min buffer wake-up was already cancelled above. Immediately
  // enqueue so prep resumes without waiting for a wake-up that will never come.
  if (
    status === "Todo" &&
    current.status === "Waiting" &&
    !current.schedule
  ) {
    await enqueueTask({ taskId, workspaceId, userId });
  }

  // Auto-start execution when task moves to Ready
  if (status === "Ready") {
    // If this transition is skipping ahead of a pending scheduled wake-up
    // (typical for the Todo+buffer case, or butler/user promoting early), we
    // must cancel the stale scheduled wake-up and clear nextRunAt — otherwise
    // the wake-up fires after execution starts and runs the pipeline a second
    // time. Only do this for non-recurring tasks; recurring tasks own their
    // nextRunAt via scheduleNextTaskOccurrence.
    if (!current.schedule && current.nextRunAt) {
      await removeScheduledTask(taskId);
      await prisma.task.update({
        where: { id: taskId },
        data: { nextRunAt: null },
      });
    }

    // Scheduled/recurring tasks must NOT be enqueued immediately — their
    // nextRunAt is still valid and the scheduled wake-up will fire at the
    // right time. Only enqueue non-scheduled tasks right away.
    if (!current.schedule) {
      // Check if this task has Waiting subtasks — if so, start the first one
      // by transitioning it to Todo (which triggers enqueue via the
      // Waiting→Todo handler above), and move parent to Working.
      const nextSubtask = await getNextBacklogSubtask(taskId);
      if (nextSubtask) {
        await changeTaskStatus(
          nextSubtask.id,
          "Todo",
          workspaceId,
          userId,
          "system",
        );
        // Parent flips directly to Working/execute (subtask sequencing is its own
        // engine; parent doesn't need its own prep pass).
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: "Working",
            metadata: setTaskPhaseInMetadata(current.metadata, "execute"),
          },
        });
        return prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      }
      // No subtasks — enqueue the task itself (existing behavior)
      await enqueueTask({ taskId, workspaceId, userId });
    }
  }

  // Subtask completed — trigger next Waiting sibling (sequential flow only),
  // or auto-complete parent if all done.
  if (status === "Done") {
    if (current.parentTaskId) {
      // Load parent to check if this is sequential flow or cherry-pick
      const parentTask = await prisma.task.findUnique({
        where: { id: current.parentTaskId },
        select: { status: true },
      });

      // Only trigger next sibling if parent is Working (sequential flow).
      // If parent is Waiting (not yet approved), this was a cherry-pick — don't cascade.
      if (parentTask?.status === "Working") {
        const nextSibling = await getNextBacklogSubtask(current.parentTaskId);
        if (nextSibling) {
          // Transition Waiting → Todo triggers enqueue
          await changeTaskStatus(
            nextSibling.id,
            "Todo",
            workspaceId,
            userId,
            "system",
          );
        } else {
          // No more Waiting siblings — check if all subtasks are done
          const activeSubtasks = await prisma.task.count({
            where: {
              parentTaskId: current.parentTaskId,
              status: { in: ["Todo", "Working", "Waiting"] },
            },
          });
          if (activeSubtasks === 0) {
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
      }
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
    data: { status, metadata: newMetadata },
  });

  // Auto-transition: when a SUBTASK moves to Review in prep phase,
  // skip the user approval gate and move directly to Ready.
  // The user already approved the parent plan — subtasks execute autonomously.
  if (
    status === "Review" &&
    current.parentTaskId &&
    currentPhase === "prep"
  ) {
    return changeTaskStatus(taskId, "Ready", workspaceId, userId, "system");
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
  const existing = await prisma.task.findUnique({ where: { id } });
  // Preserve the current phase — prep tasks should stay in prep even while
  // Working, so the agent context still knows it's planning, not executing.
  const currentPhase = existing ? getTaskPhase(existing) : "execute";
  return prisma.task.update({
    where: { id },
    data: {
      status: "Working",
      metadata: setTaskPhaseInMetadata(existing?.metadata ?? null, currentPhase),
      ...(jobId && { jobId }),
    },
  });
}

export async function markTaskCompleted(
  id: string,
  result: string,
): Promise<Task> {
  const existing = await prisma.task.findUnique({ where: { id } });
  return prisma.task.update({
    where: { id },
    data: {
      status: "Review",
      metadata: setTaskPhaseInMetadata(existing?.metadata ?? null, "execute"),
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
    const task = await prisma.task.findUnique({
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

  // Scheduled/recurring tasks skip the prep phase — the user already told us
  // when to run and (implicitly) what to do. The first execution handles any
  // clarification in the execution conversation, not a separate prep pass.
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
      metadata: setTaskPhaseInMetadata(data.metadata ?? null, "execute"),
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
    await setPageContentFromHtml(page.id, data.description);
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
 * Confirm a scheduled task as active — user wants to keep it.
 */
export async function confirmTaskActive(
  taskId: string,
  workspaceId: string,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId, workspaceId },
    data: { confirmedActive: true, unrespondedCount: 0 },
  });
  logger.info(`Confirmed task ${taskId} as active`);
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
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      workspaceId,
      isActive: true,
      nextRunAt: { not: null },
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
