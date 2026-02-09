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
export async function resetMonthlyCredits(workspaceId: string): Promise<void> {
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

  if (!workspace?.Subscription || !workspace.user?.UserUsage) {
    throw new Error("Workspace, subscription, or user usage not found");
  }

  const subscription = workspace.Subscription;
  const userUsage = workspace.user.UserUsage;
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
export async function ensureBillingInitialized(workspaceId: string) {
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

  if (!workspace?.user) {
    throw new Error("Workspace or user not found");
  }

  // Initialize subscription if missing
  if (!workspace.Subscription) {
    await initializeSubscription(workspaceId, "FREE");
  }

  // Initialize user usage if missing
  if (!workspace.user.UserUsage) {
    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId },
    });

    if (subscription) {
      await prisma.userUsage.create({
        data: {
          userId: workspace.user.id,
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
export async function getUsageSummary(workspaceId: string) {
  if (!workspaceId) {
    return null;
  }

  // Ensure billing records exist for existing accounts
  await ensureBillingInitialized(workspaceId);

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

  if (!workspace?.Subscription || !workspace.user?.UserUsage) {
    return null;
  }

  const subscription = workspace.Subscription;
  const userUsage = workspace.user.UserUsage;
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
 * Estimate credits needed based on input token count.
 * Ratio: 1000 tokens = 100 credits (i.e., 1 credit per 10 tokens)
 */
export function estimateCreditsFromTokens(tokenCount: number): number {
  return Math.max(1, Math.ceil(tokenCount / 10));
}

/**
 * Atomically reserve credits for an operation.
 * Decrements availableCredits upfront to prevent parallel over-spending.
 * Returns the number of credits reserved, or 0 if insufficient.
 */
export async function reserveCredits(
  workspaceId: string,
  amount: number,
): Promise<number> {
  if (!isBillingEnabled()) {
    return amount;
  }

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
    return 0;
  }

  const userUsage = workspace.user.UserUsage;

  if (userUsage.availableCredits < amount) {
    // Reserve whatever is available if subscription allows overage
    if (workspace.Subscription.enableUsageBilling) {
      // For overage-enabled plans, reserve the full amount
      await prisma.userUsage.update({
        where: {
          id: userUsage.id,
          availableCredits: userUsage.availableCredits, // optimistic lock
        },
        data: {
          availableCredits: Math.max(0, userUsage.availableCredits - amount),
        },
      });
      return amount;
    }
    return 0;
  }

  // Atomic decrement with optimistic lock
  try {
    await prisma.userUsage.update({
      where: {
        id: userUsage.id,
        availableCredits: { gte: amount }, // only update if still has enough
      },
      data: {
        availableCredits: { decrement: amount },
      },
    });
    return amount;
  } catch {
    // Concurrent update — credits no longer available
    return 0;
  }
}

/**
 * Refund reserved credits back to the user (e.g., on failure)
 */
export async function refundCredits(
  workspaceId: string,
  amount: number,
): Promise<void> {
  if (!isBillingEnabled() || amount <= 0) {
    return;
  }

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
    return;
  }

  await prisma.userUsage.update({
    where: { id: workspace.user.UserUsage.id },
    data: {
      availableCredits: { increment: amount },
    },
  });
}

/**
 * Reconcile reserved credits with actual usage.
 * Adjusts availableCredits for any difference and tracks actual usage in usedCredits breakdown.
 */
export async function reconcileCredits(
  workspaceId: string,
  operation: CreditOperation,
  reservedAmount: number,
  actualAmount: number,
): Promise<void> {
  if (!isBillingEnabled()) {
    return;
  }

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
    return;
  }

  const userUsage = workspace.user.UserUsage;
  const difference = actualAmount - reservedAmount;

  await prisma.userUsage.update({
    where: { id: userUsage.id },
    data: {
      // If actual > reserved, decrement more; if actual < reserved, increment (refund)
      availableCredits: difference > 0
        ? { decrement: difference }
        : difference < 0
          ? { increment: Math.abs(difference) }
          : undefined,
      usedCredits: { increment: actualAmount },
      ...(operation === "addEpisode" && {
        episodeCreditsUsed: { increment: actualAmount },
      }),
      ...(operation === "search" && {
        searchCreditsUsed: { increment: actualAmount },
      }),
      ...(operation === "chatMessage" && {
        chatCreditsUsed: { increment: actualAmount },
      }),
    },
  });
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
