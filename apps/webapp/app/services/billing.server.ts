/**
 * Billing Service
 *
 * Handles all credit management and billing operations.
 * Works in both self-hosted (unlimited) and cloud (metered) modes.
 */

import { prisma } from "~/db.server";
import {
  BILLING_CONFIG,
  getPlanConfig,
  isBillingEnabled,
} from "~/config/billing.server";
import type { PlanType, Subscription } from "@prisma/client";

export type CreditOperation = "addEpisode" | "search" | "chatMessage";

/**
 * Reset monthly credits for a workspace
 */
export async function resetMonthlyCredits(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      UserUsage: true,
    },
  });

  if (!workspace?.Subscription || !user?.UserUsage) {
    throw new Error("Workspace, subscription, or user usage not found");
  }

  const subscription = workspace.Subscription;
  const userUsage = user.UserUsage;
  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  // Create billing history record
  await prisma.billingHistory.create({
    data: {
      subscriptionId: subscription.id,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      monthlyCreditsAllocated: subscription.monthlyCredits,
      creditsUsed: userUsage.usedCredits,
      overageCreditsUsed: userUsage.overageCredits,
      subscriptionAmount: 0, // TODO: Get from Stripe
      usageAmount: subscription.overageAmount,
      totalAmount: subscription.overageAmount,
    },
  });

  // Reset credits
  await prisma.$transaction([
    prisma.userUsage.update({
      where: { id: userUsage.id },
      data: {
        availableCredits: subscription.monthlyCredits,
        usedCredits: 0,
        overageCredits: 0,
        lastResetAt: now,
        nextResetAt: nextMonth,
        // Reset usage breakdown
        episodeCreditsUsed: 0,
        searchCreditsUsed: 0,
        chatCreditsUsed: 0,
      },
    }),
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
        overageCreditsUsed: 0,
        overageAmount: 0,
      },
    }),
  ]);
}

/**
 * Initialize subscription for a workspace
 */
export async function initializeSubscription(
  workspaceId: string,
  planType: PlanType = "FREE",
): Promise<Subscription> {
  const planConfig = getPlanConfig(planType);
  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  return await prisma.subscription.create({
    data: {
      workspaceId,
      planType,
      monthlyCredits: planConfig.monthlyCredits,
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      enableUsageBilling: planConfig.enableOverage,
      usagePricePerCredit: planConfig.enableOverage
        ? planConfig.overagePrice
        : null,
    },
  });
}

/**
 * Ensure workspace has billing records initialized
 */
export async function ensureBillingInitialized(
  workspaceId: string,
  userId: string,
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      UserUsage: true,
    },
  });

  if (!user) {
    throw new Error("Workspace or user not found");
  }

  // Initialize subscription if missing
  if (!workspace?.Subscription) {
    await initializeSubscription(workspaceId, "FREE");
  }

  // Initialize user usage if missing
  if (!user.UserUsage) {
    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId },
    });

    if (subscription) {
      await prisma.userUsage.create({
        data: {
          userId: user.id,
          availableCredits: subscription.monthlyCredits,
          usedCredits: 0,
          overageCredits: 0,
          lastResetAt: new Date(),
          nextResetAt: subscription.currentPeriodEnd,
          episodeCreditsUsed: 0,
          searchCreditsUsed: 0,
          chatCreditsUsed: 0,
        },
      });
    }
  }
}

/**
 * Get workspace usage summary
 */
export async function getUsageSummary(workspaceId: string, userId: string) {
  if (!workspaceId) {
    return null;
  }

  // Ensure billing records exist for existing accounts
  await ensureBillingInitialized(workspaceId, userId);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      UserUsage: true,
    },
  });

  if (!workspace?.Subscription || !user?.UserUsage) {
    return null;
  }

  const subscription = workspace.Subscription;
  const userUsage = user.UserUsage;
  const planConfig = getPlanConfig(subscription.planType);

  return {
    plan: {
      type: subscription.planType,
      name: planConfig.name,
    },
    credits: {
      available: userUsage.availableCredits,
      used: userUsage.usedCredits,
      monthly: subscription.monthlyCredits,
      overage: userUsage.overageCredits,
      percentageUsed: Math.round(
        (userUsage.usedCredits / subscription.monthlyCredits) * 100,
      ),
    },
    usage: {
      episodes: userUsage.episodeCreditsUsed,
      searches: userUsage.searchCreditsUsed,
      chat: userUsage.chatCreditsUsed,
    },
    billingCycle: {
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
      daysRemaining: Math.ceil(
        (subscription.currentPeriodEnd.getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      ),
    },
    overage: {
      enabled: subscription.enableUsageBilling,
      pricePerCredit: subscription.usagePricePerCredit,
      amount: subscription.overageAmount,
    },
  };
}

/**
 * Check if workspace has sufficient credits
 */
export async function hasCredits(
  workspaceId: string,
  userId: string,
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
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      UserUsage: true,
    },
  });

  if (!user?.UserUsage || !workspace?.Subscription) {
    return false;
  }

  const userUsage = user.UserUsage;
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
