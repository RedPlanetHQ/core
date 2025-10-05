import {
  type Activity,
  type Conversation,
  type ConversationHistory,
  type IntegrationDefinitionV2,
  type Prisma,
  UserType,
  type UserUsage,
  type Workspace,
} from "@prisma/client";

import { logger } from "@trigger.dev/sdk/v3";
import { type CoreMessage } from "ai";

import {
  type WebSearchArgs,
  type WebSearchResult,
  type HistoryStep,
} from "./types";
import axios from "axios";
import nodeCrypto from "node:crypto";
import { customAlphabet, nanoid } from "nanoid";
import { Exa } from "exa-js";
import { prisma } from "./prisma";
import { BILLING_CONFIG, isBillingEnabled } from "~/config/billing.server";

// Token generation utilities
const tokenValueLength = 40;
const tokenGenerator = customAlphabet(
  "123456789abcdefghijkmnopqrstuvwxyz",
  tokenValueLength,
);
const tokenPrefix = "rc_pat_";

type CreatePersonalAccessTokenOptions = {
  name: string;
  userId: string;
};

// TODO remove from here
// Helper functions for token management
function createToken() {
  return `${tokenPrefix}${tokenGenerator()}`;
}

function obfuscateToken(token: string) {
  const withoutPrefix = token.replace(tokenPrefix, "");
  const obfuscated = `${withoutPrefix.slice(0, 4)}${"•".repeat(18)}${withoutPrefix.slice(-4)}`;
  return `${tokenPrefix}${obfuscated}`;
}

function encryptToken(value: string) {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  const nonce = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey,
    nonce as any,
  );

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag().toString("hex");

  return {
    nonce: nonce.toString("hex"),
    ciphertext: encrypted,
    tag,
  };
}

function hashToken(token: string): string {
  const hash = nodeCrypto.createHash("sha256");
  hash.update(token);
  return hash.digest("hex");
}

export async function getOrCreatePersonalAccessToken({
  name,
  userId,
}: CreatePersonalAccessTokenOptions) {
  // Try to find an existing, non-revoked token
  const existing = await prisma.personalAccessToken.findFirst({
    where: {
      name,
      userId,
      revokedAt: null,
    },
  });

  if (existing) {
    // Do not return the unencrypted token if it already exists
    return {
      id: existing.id,
      name: existing.name,
      userId: existing.userId,
      obfuscatedToken: existing.obfuscatedToken,
      // token is not returned
    };
  }

  // Create a new token
  const token = createToken();
  const encryptedToken = encryptToken(token);

  const personalAccessToken = await prisma.personalAccessToken.create({
    data: {
      name,
      userId,
      encryptedToken,
      obfuscatedToken: obfuscateToken(token),
      hashedToken: hashToken(token),
    },
  });

  return {
    id: personalAccessToken.id,
    name,
    userId,
    token,
    obfuscatedToken: personalAccessToken.obfuscatedToken,
  };
}

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

export const init = async ({ payload }: { payload: InitChatPayload }) => {
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

  const randomKeyName = `chat_${nanoid(10)}`;
  const pat = await getOrCreatePersonalAccessToken({
    name: randomKeyName,
    userId: workspace.userId as string,
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

  // Set up axios interceptor for memory operations
  axios.interceptors.request.use((config) => {
    if (config.url?.startsWith("https://core::memory")) {
      const originalUrl = config.url;
      // Handle both search and ingest endpoints
      if (config.url.includes("/search")) {
        config.url = `${process.env.API_BASE_URL}/api/v1/search`;
      } else if (config.url.includes("/add")) {
        config.url = `${process.env.API_BASE_URL}/api/v1/add`;
      } else if (config.url.includes("/spaces")) {
        config.url = `${process.env.API_BASE_URL}/api/v1/spaces`;
      }
      config.headers.Authorization = `Bearer ${pat.token}`;

      logger.info("Axios interceptor transformed memory URL", {
        originalUrl,
        transformedUrl: config.url,
        apiBaseUrl: process.env.API_BASE_URL,
        hasToken: !!pat.token,
        tokenPrefix: pat.token?.substring(0, 10)
      });
    }

    return config;
  });
  // Create MCP server for each integration account
  const mcpServers: string[] = integrationAccounts
    .map((account) => {
      const integrationConfig = account.integrationConfiguration as any;
      if (integrationConfig.mcp) {
        return account.integrationDefinition.slug;
      }
      return undefined;
    })
    .filter((slug): slug is string => slug !== undefined);

  return {
    conversation,
    conversationHistory,
    tokenId: pat.id,
    token: pat.token,
    userId: user?.id,
    userName: user?.name,
    mcpServers,
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

export async function deletePersonalAccessToken(tokenId: string) {
  return await prisma.personalAccessToken.delete({
    where: {
      id: tokenId,
    },
  });
}

export async function webSearch(args: WebSearchArgs): Promise<WebSearchResult> {
  const apiKey = process.env.EXA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY environment variable is required for web search",
    );
  }

  const exa = new Exa(apiKey);

  try {
    const searchOptions = {
      numResults: args.numResults || 5,
      ...(args.domains && { includeDomains: args.domains }),
      ...(args.excludeDomains && { excludeDomains: args.excludeDomains }),
      ...(args.startCrawlDate && { startCrawlDate: args.startCrawlDate }),
      ...(args.endCrawlDate && { endCrawlDate: args.endCrawlDate }),
      ...(args.startPublishedDate && {
        startPublishedDate: args.startPublishedDate,
      }),
      ...(args.endPublishedDate && { endPublishedDate: args.endPublishedDate }),
    };

    let result;

    if (args.includeContent || args.includeHighlights) {
      // Use searchAndContents for rich results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentsOptions: any = {
        ...searchOptions,
      };

      if (args.includeContent) {
        contentsOptions.text = true;
      }

      if (args.includeHighlights) {
        contentsOptions.highlights = true;
      }

      result = await exa.searchAndContents(args.query, contentsOptions);
    } else {
      // Use basic search for URLs only
      result = await exa.search(args.query, searchOptions);
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: result.results.map((item: any) => ({
        title: item.title,
        url: item.url,
        content: item.text,
        publishedDate: item.publishedDate,
        highlights: item.highlights,
        text: item.text,
        score: item.score,
      })),
    };
  } catch (error) {
    throw new Error(
      `Web search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

// Credit management functions have been moved to ~/services/billing.server.ts
// Use deductCredits() instead of these functions
export type CreditOperation = "addEpisode" | "search" | "chatMessage";

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Track usage analytics without enforcing limits (for self-hosted)
 */
async function trackUsageAnalytics(
  workspaceId: string,
  operation: CreditOperation,
  amount?: number,
): Promise<void> {
  const creditCost = amount || BILLING_CONFIG.creditCosts[operation];

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      user: {
        include: {
          UserUsage: true,
        },
      },
    },
  });

  if (!workspace?.user?.UserUsage) {
    return; // Silently fail for analytics
  }

  const userUsage = workspace.user.UserUsage;

  // Just track usage, don't enforce limits
  await prisma.userUsage.update({
    where: { id: userUsage.id },
    data: {
      usedCredits: userUsage.usedCredits + creditCost,
      ...(operation === "addEpisode" && {
        episodeCreditsUsed: userUsage.episodeCreditsUsed + creditCost,
      }),
      ...(operation === "search" && {
        searchCreditsUsed: userUsage.searchCreditsUsed + creditCost,
      }),
      ...(operation === "chatMessage" && {
        chatCreditsUsed: userUsage.chatCreditsUsed + creditCost,
      }),
    },
  });
}

/**
 * Deduct credits for a specific operation
 */
export async function deductCredits(
  workspaceId: string,
  operation: CreditOperation,
  amount?: number,
): Promise<void> {
  // If billing is disabled (self-hosted), allow unlimited usage
  if (!isBillingEnabled()) {
    // Still track usage for analytics
    await trackUsageAnalytics(workspaceId, operation, amount);
    return;
  }

  // Get the actual credit cost
  const creditCost = amount || BILLING_CONFIG.creditCosts[operation];

  // Get workspace with subscription and usage
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
      user: {
        include: {
          UserUsage: true,
        },
      },
    },
  });

  if (!workspace || !workspace.user) {
    throw new Error("Workspace or user not found");
  }

  const subscription = workspace.Subscription;
  const userUsage = workspace.user.UserUsage;

  if (!subscription) {
    throw new Error("No subscription found for workspace");
  }

  if (!userUsage) {
    throw new Error("No user usage record found");
  }

  // Check if user has available credits
  if (userUsage.availableCredits >= creditCost) {
    // Deduct from available credits
    await prisma.userUsage.update({
      where: { id: userUsage.id },
      data: {
        availableCredits: userUsage.availableCredits - creditCost,
        usedCredits: userUsage.usedCredits + creditCost,
        // Update usage breakdown
        ...(operation === "addEpisode" && {
          episodeCreditsUsed: userUsage.episodeCreditsUsed + creditCost,
        }),
        ...(operation === "search" && {
          searchCreditsUsed: userUsage.searchCreditsUsed + creditCost,
        }),
        ...(operation === "chatMessage" && {
          chatCreditsUsed: userUsage.chatCreditsUsed + creditCost,
        }),
      },
    });
  } else {
    // Check if usage billing is enabled (Pro/Max plan)
    if (subscription.enableUsageBilling) {
      // Calculate overage
      const overageAmount = creditCost - userUsage.availableCredits;
      const cost = overageAmount * (subscription.usagePricePerCredit || 0);

      // Deduct remaining available credits and track overage
      await prisma.$transaction([
        prisma.userUsage.update({
          where: { id: userUsage.id },
          data: {
            availableCredits: 0,
            usedCredits: userUsage.usedCredits + creditCost,
            overageCredits: userUsage.overageCredits + overageAmount,
            // Update usage breakdown
            ...(operation === "addEpisode" && {
              episodeCreditsUsed: userUsage.episodeCreditsUsed + creditCost,
            }),
            ...(operation === "search" && {
              searchCreditsUsed: userUsage.searchCreditsUsed + creditCost,
            }),
            ...(operation === "chatMessage" && {
              chatCreditsUsed: userUsage.chatCreditsUsed + creditCost,
            }),
          },
        }),
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            overageCreditsUsed: subscription.overageCreditsUsed + overageAmount,
            overageAmount: subscription.overageAmount + cost,
          },
        }),
      ]);
    } else {
      // Free plan - throw error
      throw new InsufficientCreditsError(
        "Insufficient credits. Please upgrade to Pro or Max plan to continue.",
      );
    }
  }
}

/**
 * Check if workspace has sufficient credits
 */
export async function hasCredits(
  workspaceId: string,
  operation: CreditOperation,
  amount?: number,
): Promise<boolean> {
  // If billing is disabled, always return true
  if (!isBillingEnabled()) {
    return true;
  }

  const creditCost = amount || BILLING_CONFIG.creditCosts[operation];

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
      user: {
        include: {
          UserUsage: true,
        },
      },
    },
  });

  if (!workspace?.user?.UserUsage || !workspace.Subscription) {
    return false;
  }

  const userUsage = workspace.user.UserUsage;
  // const subscription = workspace.Subscription;

  // If has available credits, return true
  if (userUsage.availableCredits >= creditCost) {
    return true;
  }

  // If overage is enabled (Pro/Max), return true
  // if (subscription.enableUsageBilling) {
  //   return true;
  // }

  // Free plan with no credits left
  return false;
}
