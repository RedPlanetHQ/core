import { isBillingEnabled } from "~/config/billing.server";
import { prisma } from "~/trigger/utils/prisma";
import { type CreditOperation } from "~/trigger/utils/utils";

/**
 * Atomically reserve credits for an operation.
 * Decrements availableCredits upfront to prevent parallel over-spending.
 * Returns the number of credits reserved, or 0 if insufficient.
 */
export async function reserveCredits(
  workspaceId: string,
  userId: string,
  amount: number,
): Promise<number> {
  if (!isBillingEnabled()) {
    return amount;
  }

  const userWorkspace = await prisma.userWorkspace.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    include: {
      user: {
        include: {
          UserUsage: true,
        },
      },
      workspace: {
        include: {
          Subscription: true,
        },
      },
    },
  });

  if (!userWorkspace?.user?.UserUsage || !userWorkspace.workspace.Subscription) {
    return 0;
  }

  const userUsage = userWorkspace.user.UserUsage;

  if (userUsage.availableCredits < amount) {
    // Reserve whatever is available if subscription allows overage
    if (userWorkspace.workspace.Subscription.enableUsageBilling) {
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
  userId: string,
  amount: number,
): Promise<void> {
  if (!isBillingEnabled() || amount <= 0) {
    return;
  }

  const userWorkspace = await prisma.userWorkspace.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    include: {
      user: {
        include: {
          UserUsage: true,
        },
      },
    },
  });

  if (!userWorkspace?.user?.UserUsage) {
    return;
  }

  await prisma.userUsage.update({
    where: { id: userWorkspace.user.UserUsage.id },
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
  userId: string,
  operation: CreditOperation,
  reservedAmount: number,
  actualAmount: number,
): Promise<void> {
  if (!isBillingEnabled()) {
    return;
  }

  const userWorkspace = await prisma.userWorkspace.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    include: {
      user: {
        include: {
          UserUsage: true,
        },
      },
      workspace: {
        include: {
          Subscription: true,
        },
      },
    },
  });

  if (!userWorkspace?.user?.UserUsage || !userWorkspace.workspace.Subscription) {
    return;
  }

  const userUsage = userWorkspace.user.UserUsage;
  const difference = actualAmount - reservedAmount;

  await prisma.userUsage.update({
    where: { id: userUsage.id },
    data: {
      // If actual > reserved, decrement more; if actual < reserved, increment (refund)
      availableCredits:
        difference > 0
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
 * Estimate credits needed based on input token count.
 * Ratio: 1000 tokens = 100 credits (i.e., 1 credit per 10 tokens)
 */
export function estimateCreditsFromTokens(tokenCount: number): number {
  return Math.max(1, Math.ceil(tokenCount / 10));
}
