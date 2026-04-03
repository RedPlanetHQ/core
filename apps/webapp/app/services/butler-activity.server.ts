import { prisma } from "~/db.server";

type ButlerActivityType = "conversation" | "task";
export type ButlerActivityState =
  | "idle"
  | "watching"
  | "thinking"
  | "acting"
  | "paused";

export interface ButlerActivityItem {
  id: string;
  type: ButlerActivityType;
  title: string;
  state: ButlerActivityState;
  sentence: string;
  updatedAt: string;
}

export interface ButlerActivitySummary {
  active: boolean;
  count: number;
  primary: ButlerActivityItem | null;
  items: ButlerActivityItem[];
  state: ButlerActivityState;
  stateLabel: string;
  sentence: string;
  snoozedUntil: string | null;
  pausedIndefinitely: boolean;
}

const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const SNOOZE_CACHE_TTL_MS = 15 * 1000;

const snoozeCache = new Map<
  string,
  {
    expiresAt: number;
    value: { pausedIndefinitely: boolean; snoozedUntil: string | null };
  }
>();

function getStateLabel(state: ButlerActivityState) {
  switch (state) {
    case "watching":
      return "Watching";
    case "thinking":
      return "Thinking";
    case "acting":
      return "Acting";
    case "paused":
      return "Paused";
    default:
      return "Idle";
  }
}

function describeConversationActivity(
  source: string,
  title: string | null,
  linkedTaskTitle?: string,
): { state: ButlerActivityState; sentence: string } {
  if (linkedTaskTitle) {
    return {
      state: "acting",
      sentence: linkedTaskTitle,
    };
  }

  if (title?.trim()) {
    return {
      state:
        source === "daily"
          ? "watching"
          : source === "core"
            ? "thinking"
            : "acting",
      sentence: title.trim(),
    };
  }

  if (source === "daily") {
    return {
      state: "watching",
      sentence: "Reviewing edits in Scratchpad",
    };
  }

  if (source === "reminder") {
    return {
      state: "acting",
      sentence: "Handling a reminder",
    };
  }

  if (source === "task" || source === "background-task") {
    return {
      state: "acting",
      sentence: "Working on a task",
    };
  }

  return {
    state: "thinking",
    sentence: "Working on a request",
  };
}

function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

function readSnoozeMeta(metadata: unknown) {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  return {
    pausedIndefinitely: meta.butlerPausedIndefinitely === true,
    snoozedUntil:
      typeof meta.butlerSnoozedUntil === "string" ? meta.butlerSnoozedUntil : null,
  };
}

export async function getButlerSnoozeState(workspaceId: string) {
  const cached = snoozeCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { metadata: true },
  });

  const value = readSnoozeMeta(workspace?.metadata);
  snoozeCache.set(workspaceId, {
    value,
    expiresAt: Date.now() + SNOOZE_CACHE_TTL_MS,
  });

  return value;
}

export async function setButlerSnoozeState(
  workspaceId: string,
  options:
    | { intent: "resume" }
    | { intent: "snooze"; duration: "30m" | "1h" | "tomorrow" | "indefinite" },
) {
  const existing = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { metadata: true },
  });
  const metadata = (existing?.metadata ?? {}) as Record<string, unknown>;

  const nextMeta =
    options.intent === "resume"
      ? {
          ...metadata,
          butlerPausedIndefinitely: false,
          butlerSnoozedUntil: null,
        }
      : {
          ...metadata,
          butlerPausedIndefinitely: options.duration === "indefinite",
          butlerSnoozedUntil:
            options.duration === "indefinite"
              ? null
              : options.duration === "30m"
                ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
                : options.duration === "1h"
                  ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
                  : tomorrowMorning().toISOString(),
        };

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { metadata: nextMeta },
  });

  snoozeCache.set(workspaceId, {
    value: readSnoozeMeta(nextMeta),
    expiresAt: Date.now() + SNOOZE_CACHE_TTL_MS,
  });
}

export async function isButlerSnoozed(workspaceId: string) {
  const { pausedIndefinitely, snoozedUntil } = await getButlerSnoozeState(
    workspaceId,
  );

  if (pausedIndefinitely) return true;
  if (!snoozedUntil) return false;

  const until = new Date(snoozedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

export async function getButlerActivity(
  workspaceId: string,
): Promise<ButlerActivitySummary> {
  const snoozeState = await getButlerSnoozeState(workspaceId);
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  const runningConversations = await prisma.conversation.findMany({
    where: {
      workspaceId,
      deleted: null,
      status: "running",
      updatedAt: {
        gte: cutoff,
      },
    },
    select: {
      id: true,
      title: true,
      source: true,
      asyncJobId: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 8,
  });

  const taskIds = runningConversations
    .map((conversation) => conversation.asyncJobId)
    .filter((value): value is string => Boolean(value));

  const linkedTasks = taskIds.length
    ? await prisma.task.findMany({
        where: {
          workspaceId,
          id: { in: taskIds },
        },
        select: {
          id: true,
          title: true,
        },
      })
    : [];

  const taskMap = new Map(linkedTasks.map((task) => [task.id, task]));

  const items: ButlerActivityItem[] = runningConversations.map((conversation) => {
    const linkedTask = conversation.asyncJobId
      ? taskMap.get(conversation.asyncJobId)
      : null;
    const description = describeConversationActivity(
      conversation.source,
      conversation.title,
      linkedTask?.title,
    );

    return {
      id: linkedTask ? `task-${linkedTask.id}` : `conversation-${conversation.id}`,
      type: linkedTask ? "task" : "conversation",
      title: linkedTask?.title ?? conversation.title ?? "Working on a request",
      state: description.state,
      sentence: description.sentence,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  });

  const isPaused =
    snoozeState.pausedIndefinitely ||
    (snoozeState.snoozedUntil
      ? new Date(snoozeState.snoozedUntil).getTime() > Date.now()
      : false);
  const primary = items[0] ?? null;
  const state = isPaused ? "paused" : (primary?.state ?? "idle");
  const sentence = isPaused
    ? snoozeState.pausedIndefinitely
      ? "Automatic page watching is paused until you resume it"
      : `Automatic page watching is paused until ${new Date(
          snoozeState.snoozedUntil as string,
        ).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}`
    : primary?.sentence ?? "Watching for page edits";

  return {
    active: items.length > 0,
    count: items.length,
    primary,
    items: items.slice(0, 4),
    state,
    stateLabel: getStateLabel(state),
    sentence,
    snoozedUntil: snoozeState.snoozedUntil,
    pausedIndefinitely: snoozeState.pausedIndefinitely,
  };
}
