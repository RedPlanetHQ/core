import { UserTypeEnum } from "@core/types";

import { auth, runs, tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "~/db.server";
import { createConversationTitle } from "~/trigger/conversation/create-conversation-title";

import { z } from "zod";
import { type ConversationHistory } from "@prisma/client";

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

    const context = await getConversationContext(conversationHistory.id);
    const handler = await tasks.trigger(
      "chat",
      {
        conversationHistoryId: conversationHistory.id,
        conversationId: conversationHistory.conversation.id,
        context,
      },
      { tags: [conversationHistory.id, workspaceId, conversationId] },
    );

    return {
      id: handler.id,
      token: handler.publicAccessToken,
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
  const context = await getConversationContext(conversationHistory.id);

  // Trigger conversation title task
  await tasks.trigger<typeof createConversationTitle>(
    createConversationTitle.id,
    {
      conversationId: conversation.id,
      message: conversationData.message,
    },
    { tags: [conversation.id, workspaceId] },
  );

  const handler = await tasks.trigger(
    "chat",
    {
      conversationHistoryId: conversationHistory.id,
      conversationId: conversation.id,
      context,
    },
    { tags: [conversationHistory.id, workspaceId, conversation.id] },
  );

  return {
    id: handler.id,
    token: handler.publicAccessToken,
    conversationId: conversation.id,
    conversationHistoryId: conversationHistory.id,
  };
}

// Get a conversation by ID
export async function getConversation(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
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

export async function getCurrentConversationRun(
  conversationId: string,
  workspaceId: string,
) {
  const conversationHistory = await prisma.conversationHistory.findFirst({
    where: {
      conversationId,
      conversation: {
        workspaceId,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (!conversationHistory) {
    throw new Error("No run found");
  }

  const response = await runs.list({
    tag: [conversationId, conversationHistory.id],
    status: ["QUEUED", "EXECUTING"],
    limit: 1,
  });

  const run = response.data[0];
  if (!run) {
    return undefined;
  }

  const publicToken = await auth.createPublicToken({
    scopes: {
      read: {
        runs: [run.id],
      },
    },
  });

  return {
    id: run.id,
    token: publicToken,
    conversationId,
    conversationHistoryId: conversationHistory.id,
  };
}

export async function stopConversation(
  conversationId: string,
  workspaceId: string,
) {
  const conversationHistory = await prisma.conversationHistory.findFirst({
    where: {
      conversationId,
      conversation: {
        workspaceId,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (!conversationHistory) {
    throw new Error("No run found");
  }

  const response = await runs.list({
    tag: [conversationId, conversationHistory.id],
    status: ["QUEUED", "EXECUTING"],
    limit: 1,
  });

  const run = response.data[0];
  if (!run) {
    await prisma.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        status: "failed",
      },
    });

    return undefined;
  }

  return await runs.cancel(run.id);
}

export async function getConversationContext(
  conversationHistoryId: string,
): Promise<{
  previousHistory: ConversationHistory[];
}> {
  const conversationHistory = await prisma.conversationHistory.findUnique({
    where: { id: conversationHistoryId },
    include: { conversation: true },
  });

  if (!conversationHistory) {
    return {
      previousHistory: [],
    };
  }

  // Get previous conversation history message and response
  let previousHistory: ConversationHistory[] = [];

  if (conversationHistory.conversationId) {
    previousHistory = await prisma.conversationHistory.findMany({
      where: {
        conversationId: conversationHistory.conversationId,
        id: {
          not: conversationHistoryId,
        },
        deleted: null,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  return {
    previousHistory,
  };
}
