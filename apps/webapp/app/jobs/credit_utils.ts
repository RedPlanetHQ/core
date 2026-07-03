import { isBillingEnabled } from "~/config/billing.server";
import { prisma } from "~/db.server";

import { type CreditOperation } from "~/trigger/utils/utils";

/**
 * Atomically reserve credits for an operation.
 *
 * Spend order:
 *   1. availableCredits (the monthly bucket, resets each cycle)
 *   2. topupCredits (persistent, non-expiring — bought via /settings/billing)
 *
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
  const totalAvailable = userUsage.availableCredits + userUsage.topupCredits;

  // Not enough combined balance — behave like the previous overage logic:
  // reserve whatever is left if overage billing is enabled, otherwise fail.
  if (totalAvailable < amount) {
    if (userWorkspace.workspace.Subscription.enableUsageBilling) {
      const actualDeducted = totalAvailable;
      if (actualDeducted > 0) {
        const result = await prisma.userUsage.updateMany({
          where: {
            id: userUsage.id,
            availableCredits: userUsage.availableCredits,
            topupCredits: userUsage.topupCredits,
          },
          data: {
            availableCredits: 0,
            topupCredits: 0,
          },
        });
        if (result.count === 0) {
          // Lost the race — bail; caller will retry.
          return 0;
        }
      }
      return actualDeducted;
    }
    return 0;
  }

  // Split the reservation: monthly first, then top-up.
  const fromMonthly = Math.min(userUsage.availableCredits, amount);
  const fromTopup = amount - fromMonthly;

  const result = await prisma.userUsage.updateMany({
    where: {
      id: userUsage.id,
      availableCredits: userUsage.availableCredits,
      topupCredits: userUsage.topupCredits,
    },
    data: {
      availableCredits: { decrement: fromMonthly },
      topupCredits: { decrement: fromTopup },
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
 * Reconcile reserved credits with actual usage.
 *
 * If actual > reserved: charge the extra, monthly-first then top-up.
 * If actual < reserved: refund the delta into availableCredits (best-effort
 *   accounting — the tiny amount that may leak from the top-up bucket on a
 *   refunded overshoot is acceptable and rare).
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

  let availableDelta = 0;
  let topupDelta = 0;
  if (difference > 0) {
    const extraFromMonthly = Math.min(userUsage.availableCredits, difference);
    availableDelta = -extraFromMonthly;
    topupDelta = -(difference - extraFromMonthly);
  } else if (difference < 0) {
    availableDelta = -difference; // refund to monthly bucket
  }

  await prisma.userUsage.update({
    where: { id: userUsage.id },
    data: {
      ...(availableDelta !== 0 && {
        availableCredits:
          availableDelta > 0
            ? { increment: availableDelta }
            : { decrement: -availableDelta },
      }),
      ...(topupDelta !== 0 && {
        topupCredits:
          topupDelta > 0
            ? { increment: topupDelta }
            : { decrement: -topupDelta },
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
