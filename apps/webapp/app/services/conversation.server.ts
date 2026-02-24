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
  userType: z.nativeEnum(UserTypeEnum).optional(),
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
  const { title, conversationId, source, ...otherData } = conversationData;

  if (conversationId) {
    // Add a new message to an existing conversation
    const conversationHistory = await prisma.conversationHistory.create({
      data: {
        ...otherData,
        source: source || "core",
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

// Mark a conversation as read
export async function readConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { unread: false },
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

export const getOnboardingConversation = async (
  userId: string,
  workspaceId: string,
) => {
  let conversation = await prisma.conversation.findFirst({
    where: {
      userId,
      source: "onboarding-1",
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
      },
      include: {
        ConversationHistory: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
  }

  return conversation;
};

export const upsertConversationHistory = async (
  id: string,
  parts: any,
  conversationId: string,
  userType: UserTypeEnum,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thoughts?: Record<string, any>,
) => {
  if (id) {
    return await prisma.conversationHistory.upsert({
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
  }
};

export const GetConversationsListSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("20"),
  search: z.string().optional(),
  source: z.string().default("core"),
});

export type GetConversationsListDto = z.infer<
  typeof GetConversationsListSchema
>;

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
    source: params.source,
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
