import {
  type Activity,
  type Conversation,
  type ConversationHistory,
  type IntegrationDefinitionV2,
  type Prisma,
  PrismaClient,
  UserType,
  type Workspace,
} from "@prisma/client";

import { logger } from "@trigger.dev/sdk/v3";
import { type CoreMessage } from "ai";

import { type HistoryStep } from "./types";
import axios from "axios";

const prisma = new PrismaClient();

export interface InitChatPayload {
  conversationId: string;
  conversationHistoryId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  pat: string;
}

export class Preferences {
  timezone?: string;

  // Memory details
  memory_host?: string;
  memory_api_key?: string;
}

export interface RunChatPayload {
  conversationId: string;
  conversationHistoryId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  conversation: Conversation;
  conversationHistory: ConversationHistory;
  pat: string;
  isContinuation?: boolean;
}

export const init = async (payload: InitChatPayload) => {
  logger.info("Loading init");
  const conversationHistory = await prisma.conversationHistory.findUnique({
    where: { id: payload.conversationHistoryId },
    include: { conversation: true },
  });

  const conversation = conversationHistory?.conversation as Conversation;

  const workspace = await prisma.workspace.findUnique({
    where: { id: conversation.workspaceId as string },
  });

  if (!workspace) {
    return { conversation, conversationHistory };
  }

  const pat = await prisma.personalAccessToken.findFirst({
    where: { userId: workspace.userId as string, name: "default" },
  });

  const user = await prisma.user.findFirst({
    where: { id: workspace.userId as string },
  });

  const integrationAccounts = await prisma.integrationAccount.findMany({
    where: {
      workspaceId: workspace.id,
    },
    include: { integrationDefinition: true },
  });

  // Create MCP server configurations for each integration account
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const integrationMCPServers: Record<string, any> = {};

  for (const account of integrationAccounts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spec = account.integrationDefinition?.spec as any;
      if (spec.mcp) {
        const mcpSpec = spec.mcp;
        const configuredMCP = { ...mcpSpec };

        // Replace config placeholders in environment variables
        if (configuredMCP.env) {
          for (const [key, value] of Object.entries(configuredMCP.env)) {
            if (typeof value === "string" && value.includes("${config:")) {
              // Extract the config key from the placeholder
              const configKey = value.match(/\$\{config:(.*?)\}/)?.[1];
              if (
                configKey &&
                account.integrationConfiguration &&
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (account.integrationConfiguration as any)[configKey]
              ) {
                configuredMCP.env[key] = value.replace(
                  `\${config:${configKey}}`,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (account.integrationConfiguration as any)[configKey],
                );
              }
            }

            if (
              typeof value === "string" &&
              value.includes("${integrationConfig:")
            ) {
              // Extract the config key from the placeholder
              const configKey = value.match(
                /\$\{integrationConfig:(.*?)\}/,
              )?.[1];
              if (
                configKey &&
                account.integrationDefinition.config &&
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (account.integrationDefinition.config as any)[configKey]
              ) {
                configuredMCP.env[key] = value.replace(
                  `\${integrationConfig:${configKey}}`,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (account.integrationDefinition.config as any)[configKey],
                );
              }
            }
          }
        }

        // Add to the MCP servers collection
        integrationMCPServers[account.integrationDefinition.slug] =
          configuredMCP;
      }

      axios.interceptors.request.use((config) => {
        if (config.url?.startsWith("https://core::memory")) {
          // Handle both search and ingest endpoints
          if (config.url.includes("/search")) {
            config.url = `${process.env.API_BASE_URL}/search`;
          } else if (config.url.includes("/ingest")) {
            config.url = `${process.env.API_BASE_URL}/ingest`;
          }
          config.headers.Authorization = `Bearer ${payload.pat}`;
        }

        return config;
      });
    } catch (error) {
      logger.error(
        `Failed to configure MCP for ${account.integrationDefinition?.slug}:`,
        { error },
      );
    }
  }

  return {
    conversation,
    conversationHistory,
    token: pat?.obfuscatedToken,
    userId: user?.id,
    userName: user?.name,
  };
};

export const createConversationHistoryForAgent = async (
  conversationId: string,
) => {
  return await prisma.conversationHistory.create({
    data: {
      conversationId,
      message: "Generating...",
      userType: "Agent",
      thoughts: {},
    },
  });
};

export const getConversationHistoryFormat = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[],
): string => {
  if (previousHistory) {
    const historyText = previousHistory
      .map((history) => `${history.userType}: \n ${history.message}`)
      .join("\n------------\n");

    return historyText;
  }

  return "";
};

export const getPreviousExecutionHistory = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[],
): CoreMessage[] => {
  return previousHistory.map((history) => ({
    role: history.userType === "User" ? "user" : "assistant",
    content: history.message,
  }));
};

export const getIntegrationDefinitionsForAgents = (agents: string[]) => {
  return prisma.integrationDefinitionV2.findMany({
    where: {
      slug: {
        in: agents,
      },
    },
  });
};

export const getIntegrationConfigForIntegrationDefinition = (
  integrationDefinitionId: string,
) => {
  return prisma.integrationAccount.findFirst({
    where: {
      integrationDefinitionId,
    },
  });
};

export const updateExecutionStep = async (
  step: HistoryStep,
  conversationHistoryId: string,
) => {
  const {
    thought,
    userMessage,
    skillInput,
    skillOutput,
    skillId,
    skillStatus,
    ...metadata
  } = step;

  await prisma.conversationExecutionStep.create({
    data: {
      thought: thought ?? "",
      message: userMessage ?? "",
      actionInput:
        typeof skillInput === "object"
          ? JSON.stringify(skillInput)
          : skillInput,
      actionOutput:
        typeof skillOutput === "object"
          ? JSON.stringify(skillOutput)
          : skillOutput,
      actionId: skillId,
      actionStatus: skillStatus,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: metadata as any,
      conversationHistoryId,
    },
  });
};

export const updateConversationHistoryMessage = async (
  userMessage: string,
  conversationHistoryId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thoughts?: Record<string, any>,
) => {
  await prisma.conversationHistory.update({
    where: {
      id: conversationHistoryId,
    },
    data: {
      message: userMessage,
      thoughts,
      userType: UserType.Agent,
    },
  });
};

export const getExecutionStepsForConversation = async (
  conversationHistoryId: string,
) => {
  const lastExecutionSteps = await prisma.conversationExecutionStep.findMany({
    where: {
      conversationHistoryId,
    },
  });

  return lastExecutionSteps;
};

export const getActivityDetails = async (activityId: string) => {
  if (!activityId) {
    return {};
  }

  const activity = await prisma.activity.findFirst({
    where: {
      id: activityId,
    },
  });

  return {
    activityId,
    integrationAccountId: activity?.integrationAccountId,
    sourceURL: activity?.sourceURL,
  };
};

/**
 * Generates a random ID of 6 characters
 * @returns A random string of 6 characters
 */
export const generateRandomId = (): string => {
  // Define characters that can be used in the ID
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  // Generate 6 random characters
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }

  return result.toLowerCase();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flattenObject(obj: Record<string, any>, prefix = ""): string[] {
  return Object.entries(obj).reduce<string[]>((result, [key, value]) => {
    const entryKey = prefix ? `${prefix}_${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // For nested objects, flatten them and add to results
      return [...result, ...flattenObject(value, entryKey)];
    }

    // For primitive values or arrays, add directly
    return [...result, `- ${entryKey}: ${value}`];
  }, []);
}

export const updateConversationStatus = async (
  status: string,
  conversationId: string,
) => {
  const data: Prisma.ConversationUpdateInput = { status, unread: true };

  return await prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data,
  });
};

export const getActivity = async (activityId: string) => {
  return await prisma.activity.findUnique({
    where: {
      id: activityId,
    },
    include: {
      workspace: true,
      integrationAccount: {
        include: {
          integrationDefinition: true,
        },
      },
    },
  });
};

export const updateActivity = async (
  activityId: string,
  rejectionReason: string,
) => {
  return await prisma.activity.update({
    where: {
      id: activityId,
    },
    data: {
      rejectionReason,
    },
  });
};

export const createConversation = async (
  activity: Activity,
  workspace: Workspace,
  integrationDefinition: IntegrationDefinitionV2,
  automationContext: { automations?: string[]; executionPlan: string },
) => {
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: activity.workspaceId,
      userId: workspace.userId as string,
      title: activity.text.substring(0, 100),
      ConversationHistory: {
        create: {
          userId: workspace.userId,
          message: `Activity from ${integrationDefinition.name} \n Content: ${activity.text}`,
          userType: UserType.User,
          activityId: activity.id,
          thoughts: { ...automationContext },
        },
      },
    },
    include: {
      ConversationHistory: true,
    },
  });

  return conversation;
};

export async function getContinuationAgentConversationHistory(
  conversationId: string,
): Promise<ConversationHistory | null> {
  return await prisma.conversationHistory.findFirst({
    where: {
      conversationId,
      userType: "Agent",
      deleted: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  });
}
