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
  isPaidPlan,
} from "~/config/billing.server";
import type { PlanType, Subscription } from "@prisma/client";
import Stripe from "stripe";

export type CreditOperation = "addEpisode" | "search" | "chatMessage";

// Initialize Stripe
const stripe = BILLING_CONFIG.stripe.secretKey
  ? new Stripe(BILLING_CONFIG.stripe.secretKey)
  : null;

/**
 * Get subscription amount from Stripe
 */
export async function getSubscriptionAmount(stripeSubscriptionId: string): Promise<number> {
  if (!stripe) {
    return 0;
  }

  try {
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    return stripeSubscription.items.data[0]?.price.unit_amount || 0;
  } catch (error) {
    console.error("Failed to get subscription amount from Stripe:", error);
    return 0;
  }
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
  if (!userId || !workspaceId) {
    return null;
  }

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
  if (!workspaceId || !userId) {
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
      total: userUsage.availableCredits,
      percentageUsed: subscription.monthlyCredits
        ? Math.round(
            (userUsage.usedCredits / subscription.monthlyCredits) * 100,
          )
        : 0,
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

  return user.UserUsage.availableCredits >= creditCost;
}

/**
 * Check if webhooks are available for a workspace
 * - If billing is disabled: always returns true
 * - If billing is enabled: returns true only for PRO and MAX plans
 */
export async function isWebhooksAvailableForWorkspace(
  workspaceId: string,
): Promise<boolean> {
  // If billing is disabled, webhooks are available for everyone
  if (!isBillingEnabled()) {
    return true;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
    },
  });

  if (!workspace?.Subscription) {
    // No subscription means FREE tier
    return false;
  }

  return isPaidPlan(workspace.Subscription.planType);
}

/**
 * Get webhook availability status with reason
 * Useful for displaying upgrade prompts in UI
 */
export async function getWebhookAvailability(workspaceId: string): Promise<{
  available: boolean;
  reason?: "billing_disabled" | "paid_plan" | "free_plan";
  currentPlan?: "FREE" | "PRO" | "MAX";
}> {
  // If billing is disabled, webhooks are available for everyone
  if (!isBillingEnabled()) {
    return {
      available: true,
      reason: "billing_disabled",
    };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      Subscription: true,
    },
  });

  const planType = workspace?.Subscription?.planType || "FREE";

  if (isPaidPlan(planType)) {
    return {
      available: true,
      reason: "paid_plan",
      currentPlan: planType,
    };
  }

  return {
    available: false,
    reason: "free_plan",
    currentPlan: planType,
  };
}
