import { UserTypeEnum } from "@core/types";

import { prisma } from "~/db.server";

import { z } from "zod";
import { trackFeatureUsage } from "~/services/telemetry.server";

export const CreateConversationSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  conversationId: z.string().optional(),
  userType: z.nativeEnum(UserTypeEnum).optional(),
});

export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

// Create a new conversation
export async function createConversation(
  workspaceId: string,
  userId: string,
  conversationData: CreateConversationDto,
) {
  const { title, conversationId, ...otherData } = conversationData;

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
      title:
        title?.substring(0, 100) ?? conversationData.message.substring(0, 100),
      ConversationHistory: {
        create: {
          userId,
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
      ConversationHistory: true,
    },
  });

  return conversation;
};

export const createConversationHistory = async (
  userMessage: string,
  conversationId: string,
  userType: UserTypeEnum,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thoughts?: Record<string, any>,
) => {
  return await prisma.conversationHistory.create({
    data: {
      conversationId,
      message: userMessage,
      thoughts,
      userType,
    },
  });
};

export const GetConversationsListSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("20"),
  search: z.string().optional(),
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
