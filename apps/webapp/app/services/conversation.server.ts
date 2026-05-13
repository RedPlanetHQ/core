import { UserTypeEnum } from "@core/types";

import { prisma } from "~/db.server";

import { z } from "zod";
import { trackFeatureUsage } from "~/services/telemetry.server";
import { logger } from "./logger.service";

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
  parts: z
    .array(
      z.object({
        text: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
});

export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

// Create a new conversation
export async function createConversation(
  workspaceId: string,
  userId: string,
  conversationData: CreateConversationDto,
) {
  const { title, conversationId, source, asyncJobId, incognito, ...otherData } =
    conversationData;

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

  // Create a new conversation and its first message
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId,
      userId,
      source: source || "core",
      asyncJobId: asyncJobId || null,
      incognito: incognito ?? false,
      title:
        title?.substring(0, 100) ?? conversationData.message.substring(0, 100),
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
) => {
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
      },
      update: {
        conversationId,
        parts,
        message: "",
        thoughts,
        userType,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unread },
    });
    return result;
  } else {
    await prisma.conversationHistory.create({
      data: {
        conversationId,
        parts,
        message: "",
        thoughts,
        userType,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unread },
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
