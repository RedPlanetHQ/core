/**
 * Stripe Webhook Handler
 *
 * Handles Stripe webhook events for subscription management
 * This route processes:
 * - Subscription creation/updates/cancellations
 * - Payment success/failure
 * - Usage metering for overage billing
 */

import { type ActionFunctionArgs, json } from "@remix-run/node";
import Stripe from "stripe";
import { prisma } from "~/db.server";
import { BILLING_CONFIG, getPlanConfig } from "~/config/billing.server";
import { logger } from "~/services/logger.service";
import type { PlanType } from "@prisma/client";

// Initialize Stripe
const stripe = BILLING_CONFIG.stripe.secretKey
  ? new Stripe(BILLING_CONFIG.stripe.secretKey)
  : null;

/**
 * Verify Stripe webhook signature
 */
function verifyStripeSignature(
  payload: string,
  signature: string,
): Stripe.Event {
  if (!stripe || !BILLING_CONFIG.stripe.webhookSecret) {
    throw new Error("Stripe not configured");
  }

  try {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      BILLING_CONFIG.stripe.webhookSecret,
    );
  } catch (err) {
    throw new Error(
      `Webhook signature verification failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

/**
 * Handle customer.subscription.created event
 */
async function handleSubscriptionCreated(subscription: any) {
  logger.info("Handling subscription.created", {
    subscriptionId: subscription.id,
  });

  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;

  // Determine plan type from price ID
  let planType: PlanType = "FREE";
  if (priceId === BILLING_CONFIG.plans.pro.stripePriceId) {
    planType = "PRO";
  } else if (priceId === BILLING_CONFIG.plans.max.stripePriceId) {
    planType = "MAX";
  }

  const planConfig = getPlanConfig(planType);

  // Find or create subscription record
  const existingSubscription = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (existingSubscription) {
    // Update existing subscription
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(
          subscription.current_period_end * 1000,
        ),
        planType,
        status: subscription.status === "active" ? "ACTIVE" : "TRIALING",
        monthlyCredits: planConfig.monthlyCredits,
        enableUsageBilling: planConfig.enableOverage,
        usagePricePerCredit: planConfig.enableOverage
          ? planConfig.overagePrice
          : null,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      },
    });

    // Reset user credits
    const workspace = await prisma.workspace.findUnique({
      where: { id: existingSubscription.workspaceId },
      include: { UserWorkspace: true },
    });


    if (workspace?.UserWorkspace) {
      const usersInWorkspace = await prisma.user.findMany({
        where: {
          id: {
            in: workspace.UserWorkspace.map((uw) => uw.userId)
          }
        },
        include: {
          UserUsage: true
        }
      })


      for await (const user of usersInWorkspace) {
        if (user.UserUsage) {
          await prisma.userUsage.update({
            where: { id: user.UserUsage.id },
            data: {
              availableCredits: planConfig.monthlyCredits,
              usedCredits: 0,
              overageCredits: 0,
              lastResetAt: new Date(),
              nextResetAt: new Date(subscription.current_period_end * 1000),
            },
          });
        }
      }
    }
  }
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription: any) {
  logger.info("Handling subscription.updated", {
    subscriptionId: subscription.id,
  });

  const priceId = subscription.items.data[0]?.price.id;

  // Determine plan type from price ID
  let planType: PlanType = "FREE";
  if (priceId === BILLING_CONFIG.plans.pro.stripePriceId) {
    planType = "PRO";
  } else if (priceId === BILLING_CONFIG.plans.max.stripePriceId) {
    planType = "MAX";
  }

  const planConfig = getPlanConfig(planType);

  // Update subscription
  const existingSubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (existingSubscription) {
    // Determine status - if cancel_at_period_end is true, keep as CANCELED
    let subscriptionStatus;
    if (subscription.cancel_at_period_end) {
      subscriptionStatus = "CANCELED";
    } else if (subscription.status === "active") {
      subscriptionStatus = "ACTIVE";
    } else if (subscription.status === "canceled") {
      subscriptionStatus = "CANCELED";
    } else if (subscription.status === "past_due") {
      subscriptionStatus = "PAST_DUE";
    } else if (subscription.status === "trialing") {
      subscriptionStatus = "TRIALING";
    } else if (subscription.status === "paused") {
      subscriptionStatus = "PAUSED";
    } else {
      subscriptionStatus = "ACTIVE";
    }

    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(
          subscription.current_period_end * 1000,
        ),
        planType,
        status: subscriptionStatus as any,
        monthlyCredits: planConfig.monthlyCredits,
        enableUsageBilling: planConfig.enableOverage,
        usagePricePerCredit: planConfig.enableOverage
          ? planConfig.overagePrice
          : null,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      },
    });

    // If plan changed, reset credits immediately
    if (existingSubscription.planType !== planType) {
      // Reset user credits
      const workspace = await prisma.workspace.findUnique({
        where: { id: existingSubscription.workspaceId },
        include: { UserWorkspace: true },
      });


      if (workspace?.UserWorkspace) {
        const usersInWorkspace = await prisma.user.findMany({
          where: {
            id: {
              in: workspace.UserWorkspace.map((uw) => uw.userId)
            }
          },
          include: {
            UserUsage: true
          }
        })

        for await (const user of usersInWorkspace) {
          if (user.UserUsage) {
            await prisma.userUsage.update({
              where: { id: user.UserUsage.id },
              data: {
                availableCredits: planConfig.monthlyCredits,
                usedCredits: 0,
                overageCredits: 0,
                lastResetAt: new Date(),
                nextResetAt: new Date(subscription.current_period_end * 1000),
              },
            });
          }
        }


      }
    }
  }
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  logger.info("Handling subscription.deleted", {
    subscriptionId: subscription.id,
  });

  const existingSubscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (existingSubscription) {
    // Downgrade to FREE plan
    const freeConfig = getPlanConfig("FREE");

    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        planType: "FREE",
        status: "ACTIVE", // FREE plan is now active
        monthlyCredits: freeConfig.monthlyCredits,
        enableUsageBilling: false,
        usagePricePerCredit: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        overageCreditsUsed: 0,
        overageAmount: 0,
      },
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: existingSubscription.workspaceId },
      include: { UserWorkspace: true },
    });

    if (workspace?.UserWorkspace) {
      const usersInWorkspace = await prisma.user.findMany({
        where: {
          id: {
            in: workspace.UserWorkspace.map((uw) => uw.userId)
          }
        },
        include: {
          UserUsage: true
        }
      })

      for await (const user of usersInWorkspace) {
        if (user.UserUsage) {
          await prisma.userUsage.update({
            where: { id: user.UserUsage.id },
            data: {
              availableCredits: freeConfig.monthlyCredits,
              usedCredits: 0,
              overageCredits: 0,
            },
          });
        }
      }
    }
  }
}




/**
 * Handle invoice.payment_succeeded event
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  logger.info("Handling invoice.payment_succeeded", { invoiceId: invoice.id });

  const subscriptionId = (invoice as any).subscription as string;
  const tax = (invoice as any).tax || 0;

  if (subscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      // Create billing history record
      await prisma.billingHistory.create({
        data: {
          subscriptionId: subscription.id,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          monthlyCreditsAllocated: subscription.monthlyCredits,
          creditsUsed: 0, // Will be updated from UserUsage
          overageCreditsUsed: subscription.overageCreditsUsed,
          subscriptionAmount: (invoice.amount_paid - (tax || 0)) / 100,
          usageAmount: subscription.overageAmount,
          totalAmount: invoice.amount_paid / 100,
          stripeInvoiceId: invoice.id,
          stripePaymentStatus: invoice.status || "paid",
        },
      });

      // Reset overage tracking after successful payment
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          overageCreditsUsed: 0,
          overageAmount: 0,
        },
      });
    }
  }
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  logger.error("Handling invoice.payment_failed", { invoiceId: invoice.id });

  const subscriptionId = (invoice as any).subscription as string;

  if (subscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "PAST_DUE",
        },
      });

      // TODO: Send email notification to user about failed payment
    }
  }
}

/**
 * Main webhook handler
 */
export async function action({ request }: ActionFunctionArgs) {
  // Check if billing is enabled
  if (!BILLING_CONFIG.enabled) {
    return json({ error: "Billing is not enabled" }, { status: 400 });
  }

  if (!stripe) {
    return json({ error: "Stripe not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const payload = await request.text();

  try {
    const event = verifyStripeSignature(payload, signature);

    logger.info("Received Stripe webhook", {
      type: event.type,
      id: event.id,
    });

    // Handle different event types
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
        );
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
    }

    return json({ received: true });
  } catch (err) {
    logger.error("Webhook handler error", { error: err });
    return json(
      { error: err instanceof Error ? err.message : "Webhook handler failed" },
      { status: 400 },
    );
  }
}
