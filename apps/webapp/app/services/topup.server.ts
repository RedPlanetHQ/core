/**
 * Credit Top-up Service
 *
 * One-time credit top-ups can settle via two webhooks that must land the
 * same way:
 *   1. `checkout.session.completed` — sync card payments.
 *   2. `checkout.session.async_payment_succeeded` — ACH / wallets that
 *      settle asynchronously. The initial `completed` event carries
 *      `payment_status: "unpaid"`, so we skip it, and Stripe fires this
 *      follow-up event once the money actually clears.
 *
 * `completeTopup` is the single write path — idempotent, safe to call
 * multiple times, no-ops on already-completed rows.
 */

import type Stripe from "stripe";
import { prisma } from "~/db.server";
import { ensureBillingInitialized } from "~/services/billing.server";
import { logger } from "~/services/logger.service";

export type CompleteTopupResult =
  | { status: "completed"; credits: number }
  | { status: "already_completed" }
  | { status: "unpaid"; paymentStatus: string | null }
  | { status: "topup_not_found" }
  | { status: "usage_missing_and_uninitializable" };

/**
 * Complete a topup by ID. Idempotent — returns `already_completed`
 * without touching balances if the row is already done.
 *
 * When the session's `payment_status` isn't `paid`, we return `unpaid` so
 * the webhook can no-op and wait for `async_payment_succeeded`.
 *
 * When `UserUsage` doesn't exist for the user, we auto-provision via
 * `ensureBillingInitialized` — previously the webhook would silently
 * return here, leaving the topup stuck in `pending` forever.
 */
export async function completeTopup(
  topupId: string,
  session: Stripe.Checkout.Session,
): Promise<CompleteTopupResult> {
  const topup = await prisma.creditTopup.findUnique({
    where: { id: topupId },
  });
  if (!topup) {
    logger.error("[topup] not found", { topupId, sessionId: session.id });
    return { status: "topup_not_found" };
  }

  if (topup.status === "completed") {
    return { status: "already_completed" };
  }

  if (session.payment_status !== "paid") {
    logger.info(
      "[topup] session not yet paid — will settle on async_payment_succeeded",
      {
        topupId,
        sessionId: session.id,
        payment_status: session.payment_status,
      },
    );
    return { status: "unpaid", paymentStatus: session.payment_status ?? null };
  }

  let userUsage = await prisma.userUsage.findUnique({
    where: { userId: topup.userId },
  });
  if (!userUsage) {
    await ensureBillingInitialized(topup.workspaceId, topup.userId);
    userUsage = await prisma.userUsage.findUnique({
      where: { userId: topup.userId },
    });
  }
  if (!userUsage) {
    logger.error(
      "[topup] UserUsage still missing after init — aborting credit grant",
      {
        topupId,
        userId: topup.userId,
        workspaceId: topup.workspaceId,
      },
    );
    return { status: "usage_missing_and_uninitializable" };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  // Race guard: two concurrent handlers (e.g. `completed` + `async_payment_
  // succeeded` arriving close together, or Stripe re-delivery after a
  // timeout) can both read status="pending" above. The `updateMany` with a
  // status guard is atomic — only the winner sees `count === 1` and
  // increments availableCredits. The loser sees count===0 and no-ops. The
  // earlier `topup.status === "completed"` check is the fast path for
  // already-settled rows; this is the correctness guarantee.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.creditTopup.updateMany({
      where: { id: topup.id, status: "pending" },
      data: {
        status: "completed",
        completedAt: new Date(),
        stripePaymentIntentId: paymentIntentId,
        stripeCheckoutSessionId: session.id,
      },
    });
    if (claim.count === 0) {
      return false;
    }
    await tx.userUsage.update({
      where: { id: userUsage!.id },
      data: {
        availableCredits: { increment: topup.credits },
      },
    });
    return true;
  });

  if (!claimed) {
    logger.info(
      "[topup] concurrent handler already completed — no credits granted this time",
      { topupId: topup.id, sessionId: session.id },
    );
    return { status: "already_completed" };
  }

  logger.info("[topup] completed and credits granted", {
    topupId: topup.id,
    userId: topup.userId,
    workspaceId: topup.workspaceId,
    credits: topup.credits,
  });

  return { status: "completed", credits: topup.credits };
}

/**
 * Look up the topup for a checkout session, preferring the `topupId`
 * metadata (set by `createTopupCheckoutSession`) and falling back to the
 * session id (covers the small window where the session-id update raced
 * the webhook).
 */
export async function findTopupForSession(
  session: Stripe.Checkout.Session,
): Promise<{ id: string } | null> {
  const topupId = session.metadata?.topupId as string | undefined;
  if (topupId) {
    const row = await prisma.creditTopup.findUnique({
      where: { id: topupId },
      select: { id: true },
    });
    if (row) return row;
  }
  return prisma.creditTopup.findUnique({
    where: { stripeCheckoutSessionId: session.id },
    select: { id: true },
  });
}
