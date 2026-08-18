import { UserTypeEnum } from "@core/types";

import { prisma } from "~/db.server";

import { z } from "zod";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { logger } from "./logger.service";
import { publishRowEvent } from "~/services/conversation-pubsub.server";

export const CreateConversationSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  conversationId: z.string().optional(),
  source: z.string().optional(),
  incognito: z
    .preprocess((v) => v === "true" || v === true, z.boolean())
    .optional(),
  userType: z.nativeEnum(UserTypeEnum).optional(),
  asyncJobId: z.string().optional(),
  modelId: z.string().optional(),
  panelMode: z
    .preprocess((v) => v === "true" || v === true, z.boolean())
    .optional(),
  voiceMode: z
    .preprocess((v) => v === "true" || v === true, z.boolean())
    .optional(),
  /** Owning agent for the conversation. Set when the chat is opened via a
   *  specific agent's sidebar row (?agent=<id>). Only used on conversation
   *  creation — appending to an existing conversation keeps the original
   *  owner. */
  agentId: z.string().optional(),
  parts: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        url: z.string().optional(),
        mediaType: z.string().optional(),
        filename: z.string().optional(),
      }),
    )
    .optional(),
});

export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

/**
 * Pick a fixed title for a new conversation. Ordering:
 *   1. Explicit `title` from the caller (task creation passes the task title)
 *   2. Task title if `asyncJobId` looks up to a task
 *   3. Owning agent's display name (chat with a specific agent)
 *   4. First 100 chars of the first user message as a last resort
 *
 * Cheap and deterministic — replaces the old LLM auto-title job.
 */
async function resolveConversationTitle(params: {
  explicitTitle?: string;
  asyncJobId: string | null;
  agentDisplayName: string | null;
  fallbackMessage: string;
}): Promise<string> {
  const { explicitTitle, asyncJobId, agentDisplayName, fallbackMessage } =
    params;
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle.substring(0, 100);
  }
  if (asyncJobId) {
    // Task conversations: title = task title. The Task table's id column is
    // uuid so the asyncJobId lookup is direct. If the row is missing (this
    // path is also used for generic async jobs like Slack sessions) fall
    // through to the agent name.
    try {
      const task = await prisma.task.findUnique({
        where: { id: asyncJobId },
        select: { title: true },
      });
      if (task?.title) return task.title.substring(0, 100);
    } catch {
      // asyncJobId isn't a valid task id (e.g. slack thread_ts) — fine,
      // just fall through.
    }
  }
  if (agentDisplayName && agentDisplayName.trim().length > 0) {
    return agentDisplayName.substring(0, 100);
  }
  return (fallbackMessage ?? "").substring(0, 100);
}

// Create a new conversation
export async function createConversation(
  workspaceId: string,
  userId: string,
  conversationData: CreateConversationDto,
) {
  const {
    title,
    conversationId,
    source,
    asyncJobId,
    incognito,
    agentId,
    ...otherData
  } = conversationData;

  if (conversationId) {
    // Add a new message to an existing conversation
    const conversationHistory = await prisma.conversationHistory.create({
      data: {
        ...otherData,
        userType: otherData.userType || UserTypeEnum.User,
        ...(userId && {
          user: {
            connect: { id: userId },
          },
        }),
        conversation: {
          connect: { id: conversationId },
        },
      },
      include: {
        conversation: true,
      },
    });

    // Track conversation message
    trackFeatureUsage("conversation_message_sent", userId).catch(console.error);

    return {
      conversationId: conversationHistory.conversation.id,
      conversationHistoryId: conversationHistory.id,
    };
  }

  // Resolve owning agent: caller-supplied `agentId` wins; otherwise fall
  // back to the workspace's generalist so every new thread has an owner.
  let owningAgent: { id: string; displayName: string } | null = null;
  if (agentId) {
    owningAgent = await prisma.agents.findUnique({
      where: { id: agentId },
      select: { id: true, displayName: true },
    });
  }
  if (!owningAgent) {
    const generalist = await prisma.agents.findFirst({
      where: {
        workspaceId,
        metadata: { path: ["role"], equals: "generalist" } as never,
      },
      select: { id: true, displayName: true },
    });
    owningAgent = generalist ?? null;
  }

  // Fixed titles: task conversations get the task title, agent-scoped
  // conversations get the agent's display name, everything else falls
  // back to a first-message excerpt. Auto-title generation via LLM has
  // been removed — noisy and expensive for the value it provided.
  const resolvedTitle = await resolveConversationTitle({
    explicitTitle: title,
    asyncJobId: asyncJobId ?? null,
    agentDisplayName: owningAgent?.displayName ?? null,
    fallbackMessage: conversationData.message,
  });

  // Create a new conversation and its first message
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      source: source || "core",
      asyncJobId: asyncJobId || null,
      incognito: incognito ?? false,
      title: resolvedTitle,
      ...(owningAgent ? { agentId: owningAgent.id } : {}),
      ConversationHistory: {
        create: {
          ...(userId && {
            user: {
              connect: { id: userId },
            },
          }),
          userType: otherData.userType || UserTypeEnum.User,
          ...otherData,
        },
      },
    },
    include: {
      ConversationHistory: true,
    },
  });

  const conversationHistory = conversation.ConversationHistory[0];

  // Track new conversation creation
  trackFeatureUsage("conversation_created", userId).catch(console.error);

  return {
    conversationId: conversation.id,
    conversationHistoryId: conversationHistory.id,
  };
}

// Get a conversation by ID
export async function getConversation(conversationId: string, userId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId, userId },
  });
}

/**
 * The dashboard's default source — the in-app chat surface. Integration events
 * (gmail, linear, ...) land on their own source string, giving each (agent,
 * source) pair its own endless-scroll thread.
 */
export const CORE_CONVERSATION_SOURCE = "core";

/**
 * Return THE single conversation for (workspaceId, userId, agentId, source),
 * creating an empty one on first access. Every (agent, source) pair has
 * exactly one thread — the dashboard is `source="core"`, Gmail events go to
 * `source="gmail"`, Linear to `source="linear"`, etc.
 *
 * We key by (agent, user, source) so multi-user workspaces don't leak threads
 * between members. When a workspace has only one user (the common case), this
 * is effectively "one thread per (agent, source)".
 *
 * Task-scoped threads (source="task") are excluded — they're the private,
 * per-task chats owned by the task page and must never be picked as an
 * agent's endless-scroll home.
 *
 * Threads with `asyncJobId` set ARE eligible: the integration-webhook and
 * scheduled-task pipelines key their rows that way, and opening
 * `?src=gmail` has to land in the thread those triggers are actually
 * writing to — not mint a parallel empty one beside it. When more than one
 * row matches (the webhook pipeline rolls over to a fresh row every 100
 * messages) we take the most recently active.
 */
export async function getOrCreateAgentConversation(
  workspaceId: string,
  userId: string,
  agentId: string,
  source: string = CORE_CONVERSATION_SOURCE,
): Promise<{ conversationId: string; created: boolean }> {
  if (source === TASK_CONVERSATION_SOURCE) {
    source = CORE_CONVERSATION_SOURCE;
  }

  const existing = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      userId,
      agentId,
      source,
      deleted: null,
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return { conversationId: existing.id, created: false };

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      agentId,
      source,
      title: null,
    },
    select: { id: true },
  });
  trackFeatureUsage("conversation_created", userId).catch(console.error);
  return { conversationId: created.id, created: true };
}

/**
 * Return THE per-(task, agent) conversation, creating an empty one on first
 * access. Task-scoped chats are keyed by (taskId, agentId) — if the task's
 * assigned agent is reassigned, calling this with the new agentId opens (or
 * creates) a fresh row for that agent while the previous agent's thread
 * stays untouched.
 *
 * `asyncJobId` doubles as the task reference — Conversation.asyncJobId is
 * how a row is pinned to a task in this codebase; no separate taskId column.
 * `source` is always "task" for these rows so they're easy to filter.
 */
export const TASK_CONVERSATION_SOURCE = "task";

export async function getOrCreateTaskConversation(
  workspaceId: string,
  userId: string,
  taskId: string,
  agentId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const existing = await prisma.conversation.findFirst({
    where: {
      workspaceId,
      userId,
      agentId,
      asyncJobId: taskId,
      source: TASK_CONVERSATION_SOURCE,
      deleted: null,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { conversationId: existing.id, created: false };

  const created = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      agentId,
      asyncJobId: taskId,
      source: TASK_CONVERSATION_SOURCE,
      title: null,
    },
    select: { id: true },
  });
  trackFeatureUsage("conversation_created", userId).catch(console.error);
  return { conversationId: created.id, created: true };
}

/**
 * List a given agent's conversations, ordered by most-recent activity.
 * Powers the History popover — the dashboard thread plus every trigger-driven
 * thread the agent has been used from (gmail, linear, scheduled-task, ...).
 *
 * Only `source="task"` rows are excluded: those are the private per-task
 * chats surfaced from the task page itself, not part of the agent's history.
 * Rows with `asyncJobId` set are deliberately included — that's how the
 * integration-webhook / scheduled-task pipelines key their threads, and they
 * are exactly what the user wants to see here.
 */
export async function listAgentConversations(
  workspaceId: string,
  userId: string,
  agentId: string,
) {
  return prisma.conversation.findMany({
    where: {
      workspaceId,
      userId,
      agentId,
      source: { not: TASK_CONVERSATION_SOURCE },
      deleted: null,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      source: true,
      title: true,
      updatedAt: true,
      unread: true,
    },
  });
}

// Delete a conversation (soft delete)
export async function deleteConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      deleted: new Date().toISOString(),
    },
  });
}

export async function deleteConversationsBySource(
  userId: string,
  source: string,
) {
  return prisma.conversation.updateMany({
    where: { userId, source, deleted: null },
    data: { deleted: new Date().toISOString() },
  });
}

// Mark a conversation as read
export async function readConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { unread: false },
  });
}

export async function updateConversationStatus(
  conversationId: string,
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "need_attention",
) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status },
  });
}

// Mark all conversations as read for a user
export async function readAllConversations(userId: string) {
  return prisma.conversation.updateMany({
    where: { userId, unread: true, deleted: null },
    data: { unread: false },
  });
}

export async function setActiveStreamId(
  conversationId: string,
  streamId: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeStreamId: streamId },
  });
}

export async function clearActiveStreamId(
  conversationId: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeStreamId: null },
  });
}

/**
 * Slice the raw history array down to what belongs in the LLM's live context
 * window. Rules (in priority order):
 *
 *   1. Default → messages authored today (server local day).
 *   2. If today has < MIN_LIVE_CONTEXT rows → fall back to the last
 *      MIN_LIVE_CONTEXT rows across all history. Covers "first message of
 *      the day where today is empty" and "sparse days".
 *   3. Hard ceiling on today → if today > MAX_LIVE_CONTEXT rows, keep only
 *      the most recent MAX_LIVE_CONTEXT.
 *
 * Anything not selected here still lives in the DB and stays reachable via
 * memory search — the LLM just doesn't see it inline.
 *
 * Pure, timezone-independent (uses server-local day). Exported for tests.
 */
export const MIN_LIVE_CONTEXT = 10;
export const MAX_LIVE_CONTEXT = 60;

export function sliceTurnContext<T extends { createdAt: Date | string }>(
  history: T[],
): T[] {
  if (history.length === 0) return history;

  // Determine "today" boundary — server-local midnight. Comparing on
  // getTime() means both Date and ISO string createdAt work.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const boundary = start.getTime();

  const todays = history.filter((h) => {
    const t = new Date(h.createdAt).getTime();
    return t >= boundary;
  });

  if (todays.length >= MIN_LIVE_CONTEXT) {
    // Cap today's runs on very active days.
    if (todays.length > MAX_LIVE_CONTEXT) {
      return todays.slice(-MAX_LIVE_CONTEXT);
    }
    return todays;
  }

  // Sparse day (or brand-new day) → last MIN_LIVE_CONTEXT overall.
  return history.slice(-MIN_LIVE_CONTEXT);
}

/**
 * How many history rows a chat surface loads at a time. Threads owned by an
 * agent are endless — a Gmail thread accumulates every event the integration
 * ever pushed — so neither the loader nor the live refetch can afford to pull
 * the whole table.
 */
export const CONVERSATION_PAGE_SIZE = 30;

/**
 * Keyset cursor for history pagination. `createdAt` alone isn't unique —
 * a burst of rows written in the same millisecond would straddle a page
 * boundary and either duplicate or drop rows — so the cursor is the
 * (createdAt, id) tuple, matching the compound orderBy below.
 */
function encodeHistoryCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function decodeHistoryCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const sep = cursor.lastIndexOf("|");
  if (sep <= 0) return null;
  const createdAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

/**
 * Fetch one page of a conversation's history, newest-first internally but
 * returned in ascending (render) order.
 *
 * Paging direction is backwards: with no cursor you get the newest
 * `limit` rows (what the chat opens on); passing the returned `nextCursor`
 * as `before` walks further up the thread. `hasMore` says whether anything
 * remains above the page you just got.
 *
 * Returns null when the conversation doesn't exist or isn't this user's —
 * ownership is checked here so callers don't have to.
 */
export const getConversationHistoryPage = async (
  conversationId: string,
  userId: string,
  opts: { before?: string; limit?: number } = {},
) => {
  const limit = Math.min(Math.max(opts.limit ?? CONVERSATION_PAGE_SIZE, 1), 100);

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
      deleted: null,
    },
  });

  if (!conversation) return null;

  const cursor = opts.before ? decodeHistoryCursor(opts.before) : null;

  const rows = await prisma.conversationHistory.findMany({
    where: {
      conversationId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    // Compound order must mirror the cursor tuple exactly, otherwise the
    // keyset comparison above doesn't line up with the sort and rows leak
    // across page boundaries.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row purely to answer "is there another page?" without a
    // second count query. It's dropped before returning.
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const oldest = page[page.length - 1];

  return {
    ...conversation,
    // Reverse into render order — the query ran newest-first so the cursor
    // could walk backwards, but the UI reads top-to-bottom.
    ConversationHistory: page.reverse(),
    hasMore,
    nextCursor: hasMore && oldest ? encodeHistoryCursor(oldest) : null,
  };
};

export const getConversationAndHistory = async (
  conversationId: string,
  userId: string,
) => {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
      deleted: null,
    },
    include: {
      ConversationHistory: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  return conversation;
};

/**
 * Hidden first-turn user message seeded into every onboarding
 * conversation. The user never sees it (the conversation UI hides the
 * first user message when source === "onboarding"), but the agent does,
 * and treats it as the trigger to start the onboarding flow described
 * in the <onboarding_mode> prompt block.
 */
const ONBOARDING_SEED_MESSAGE =
  "this is me coming here for the first time. take a look at my email from the last 60 days and tell me a few specific things you noticed about me — be specific, no fluff. then based on what you learned, suggest 1-2 integrations i should connect so you can see more of my work.";

export const getOnboardingConversation = async (
  userId: string,
  workspaceId: string,
) => {
  let conversation = await prisma.conversation.findFirst({
    where: {
      userId,
      source: "onboarding",
    },
    include: {
      ConversationHistory: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        workspaceId,
        source: "onboarding",
        title: "Onboarding",
        ConversationHistory: {
          create: {
            userId,
            userType: UserTypeEnum.User,
            parts: [{ text: ONBOARDING_SEED_MESSAGE, type: "text" }],
            message: ONBOARDING_SEED_MESSAGE,
          },
        },
      },
      include: {
        ConversationHistory: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
  } else if (conversation.ConversationHistory.length === 0) {
    // Conversation exists but the seed never landed (legacy row from
    // an earlier version of this helper). Insert it now so the agent
    // has something to react to on its first turn.
    await prisma.conversationHistory.create({
      data: {
        conversationId: conversation.id,
        userId,
        userType: UserTypeEnum.User,
        parts: [{ text: ONBOARDING_SEED_MESSAGE, type: "text" }],
        message: ONBOARDING_SEED_MESSAGE,
      },
    });
    // Refetch so the caller gets the populated history.
    conversation = await prisma.conversation.findFirst({
      where: { id: conversation.id },
      include: {
        ConversationHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  return conversation;
};

export async function createEmptyConversation(
  workspaceId: string,
  userId: string,
  title: string,
  asyncJobId?: string,
) {
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      source: "task",
      title: title.substring(0, 100),
      asyncJobId: asyncJobId ?? null,
    },
    include: { ConversationHistory: true },
  });

  trackFeatureUsage("conversation_created", userId).catch(console.error);

  return conversation;
}

export const upsertConversationHistory = async (
  id: string,
  parts: any,
  conversationId: string,
  userType: UserTypeEnum,
  unread: boolean = true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thoughts?: Record<string, any>,
  agentId?: string | null,
) => {
  let resultId: string | null = null;
  let resultStatus: string | null = null;
  if (id) {
    const result = await prisma.conversationHistory.upsert({
      where: {
        id,
      },
      create: {
        id,
        conversationId,
        parts,
        message: "",
        thoughts,
        userType,
        ...(agentId !== undefined ? { agentId } : {}),
      },
      update: {
        conversationId,
        parts,
        message: "",
        thoughts,
        userType,
        ...(agentId !== undefined ? { agentId } : {}),
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unread },
    });
    resultId = result.id;
    resultStatus = (result as { status?: string | null }).status ?? null;
    // Fire-and-forget pubsub notification so connected SSE clients pick
    // up the new/updated row without polling. Published AFTER the write
    // commits so subscribers who refetch the row see it.
    void publishRowEvent({
      type: "row-upsert",
      rowId: resultId,
      conversationId,
      agentId: agentId ?? null,
      status: resultStatus,
      ts: Date.now(),
    });
    return result;
  } else {
    const row = await prisma.conversationHistory.create({
      data: {
        conversationId,
        parts,
        message: "",
        thoughts,
        userType,
        ...(agentId !== undefined ? { agentId } : {}),
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unread },
    });
    void publishRowEvent({
      type: "row-upsert",
      rowId: row.id,
      conversationId,
      agentId: agentId ?? null,
      status: (row as { status?: string | null }).status ?? null,
      ts: Date.now(),
    });
  }
};

export const GetConversationsListSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("20"),
  search: z.string().optional(),
  source: z.string().optional(),
  unread: z.string().optional(),
  asyncJobId: z.string().optional(),
});

export type GetConversationsListDto = z.infer<
  typeof GetConversationsListSchema
>;

/**
 * Finds the latest assistant history entry and marks the tool call with the
 * given toolCallId as approval-requested. Called when the stream detects a
 * data-tool-call-approval chunk so the approval UI renders correctly after reload.
 */
export async function markToolCallApprovalRequested(
  conversationId: string,
  toolCallId: string,
  approvalId: string,
): Promise<void> {
  const latest = await prisma.conversationHistory.findFirst({
    where: { conversationId, userType: UserTypeEnum.Agent },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return;

  const parts = (latest.parts as any[]) ?? [];
  let changed = false;
  const updatedParts = parts.map((part: any) => {
    if (part?.toolCallId === toolCallId) {
      changed = true;
      return { ...part, state: "approval-requested", approval: { id: approvalId } };
    }
    return part;
  });
  if (!changed) return;

  await prisma.conversationHistory.update({
    where: { id: latest.id },
    data: { parts: updatedParts },
  });
}

export async function getConversationSources(
  workspaceId: string,
  userId: string,
): Promise<{ source: string; count: number }[]> {
  const rows = await prisma.conversation.groupBy({
    by: ["source"],
    where: { workspaceId, userId, deleted: null, NOT: { source: "task" } },
    _count: { source: true },
  });
  return rows.map((r) => ({ source: r.source, count: r._count.source }));
}

export async function getConversationsList(
  workspaceId: string,
  userId: string,
  params: GetConversationsListDto,
) {
  const page = parseInt(params.page);
  const limit = parseInt(params.limit);
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    userId,
    deleted: null,
    ...(params.source && {
      source: params.source,
    }),
    ...(params.asyncJobId && {
      asyncJobId: params.asyncJobId,
    }),
    ...(params.unread === "true" && {
      unread: true,
    }),
    ...(params.search && {
      OR: [
        {
          title: {
            contains: params.search,
            mode: "insensitive" as const,
          },
        },
        {
          ConversationHistory: {
            some: {
              message: {
                contains: params.search,
                mode: "insensitive" as const,
              },
            },
          },
        },
      ],
    }),
  };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        ConversationHistory: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ]);

  return {
    conversations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  };
}

/**
 * Check if user has sent a WhatsApp message within the last 24 hours.
 * Per WhatsApp Business API guidelines, businesses can only send
 * proactive messages within this 24-hour window.
 */
export async function isWithinWhatsApp24hWindow(
  workspaceId: string,
): Promise<boolean> {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentUserMessage = await prisma.conversationHistory.findFirst({
      where: {
        conversation: {
          workspaceId,
          source: "whatsapp",
        },
        userType: "User",
        createdAt: { gte: cutoffTime },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const isWithin = recentUserMessage !== null;
    logger.info(
      `WhatsApp 24h window check for workspace ${workspaceId}: ${isWithin}`,
      {
        lastUserMessage: recentUserMessage?.createdAt,
        cutoffTime,
      },
    );

    return isWithin;
  } catch (error) {
    logger.error("Failed to check WhatsApp 24h window", { error });
    // Default to false (don't send) if we can't check
    return false;
  }
}

export type TaskRun = {
  id: string;
  createdAt: Date;
  status: string;
  lastMessage: { text: string; userType: string } | null;
};

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
      return part.text;
    }
  }
  return "";
}

export async function getTaskRuns(
  taskId: string,
  workspaceId: string,
): Promise<TaskRun[]> {
  const conversations = await prisma.conversation.findMany({
    where: { asyncJobId: taskId, deleted: null, workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      ConversationHistory: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { parts: true, userType: true },
      },
    },
  });

  return conversations.map((c) => ({
    id: c.id,
    createdAt: c.createdAt,
    status: c.status,
    lastMessage: c.ConversationHistory[0]
      ? {
          text: extractTextFromParts(c.ConversationHistory[0].parts),
          userType: c.ConversationHistory[0].userType,
        }
      : null,
  }));
}
