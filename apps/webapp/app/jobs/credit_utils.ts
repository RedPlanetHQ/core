import { isBillingEnabled } from "~/config/billing.server";
import { prisma } from "~/db.server";

import { type CreditOperation } from "~/trigger/utils/utils";

/**
 * Atomically reserve credits from the user's `availableCredits` balance.
 * Top-ups increment this same bucket, so there's no second pool to walk.
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

  if (
    !userWorkspace?.user?.UserUsage ||
    !userWorkspace.workspace.Subscription
  ) {
    return 0;
  }

  const userUsage = userWorkspace.user.UserUsage;

  if (userUsage.availableCredits < amount) {
    return 0;
  }

  const result = await prisma.userUsage.updateMany({
    where: {
      id: userUsage.id,
      availableCredits: userUsage.availableCredits,
    },
    data: {
      availableCredits: { decrement: amount },
    },
  });

  if (result.count === 0) {
    // Optimistic lock lost — credits changed underneath us.
    return 0;
  }
  return amount;
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
 * Reconcile reserved credits with actual usage against the single
 * `availableCredits` bucket. Excess reservation is refunded; shortfall
 * is deducted (clamped, since reserveCredits should have gated it).
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

  if (
    !userWorkspace?.user?.UserUsage ||
    !userWorkspace.workspace.Subscription
  ) {
    return;
  }

  const userUsage = userWorkspace.user.UserUsage;
  const difference = actualAmount - reservedAmount;

  await prisma.userUsage.update({
    where: { id: userUsage.id },
    data: {
      ...(difference !== 0 && {
        availableCredits:
          difference > 0
            ? { decrement: Math.min(userUsage.availableCredits, difference) }
            : { increment: -difference },
      }),
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
