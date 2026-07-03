/**
 * Stripe Service
 *
 * Handles Stripe API operations for subscription management
 */

import Stripe from "stripe";
import { prisma } from "~/db.server";
import {
  BILLING_CONFIG,
  getPlanConfig,
  isStripeConfigured,
  validateTopupAmount,
} from "~/config/billing.server";

// Initialize Stripe
const stripe = BILLING_CONFIG.stripe.secretKey
  ? new Stripe(BILLING_CONFIG.stripe.secretKey)
  : null;

/**
 * Create or retrieve Stripe customer for a workspace
 */
export async function getOrCreateStripeCustomer(
  workspaceId: string,
  email: string,
  name?: string,
): Promise<string> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  // Check if workspace already has a Stripe customer
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (subscription?.stripeCustomerId) {
    return subscription.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      workspaceId,
    },
  });

  // Update subscription with customer ID
  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        stripeCustomerId: customer.id,
      },
    });
  }

  return customer.id;
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession({
  workspaceId,
  planType,
  email,
  successUrl,
  cancelUrl,
}: {
  workspaceId: string;
  planType: "PRO" | "MAX";
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const planConfig = getPlanConfig(planType) as any;

  if (!planConfig.stripePriceId) {
    throw new Error(`No Stripe price ID configured for ${planType} plan`);
  }

  // Get or create customer
  const customerId = await getOrCreateStripeCustomer(workspaceId, email);

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: planConfig.stripePriceId,
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      workspaceId,
      planType,
    },
  });

  return session.url!;
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createBillingPortalSession({
  workspaceId,
  returnUrl,
}: {
  workspaceId: string;
  returnUrl: string;
}): Promise<string> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error("No Stripe customer found for this workspace");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(workspaceId: string): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active subscription found");
  }

  // Cancel at period end
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CANCELED",
    },
  });
}

/**
 * Cancel a subscription immediately (for account deletion)
 */
export async function cancelSubscriptionImmediately(
  subscriptionId: string,
): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  // Cancel immediately
  await stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Reactivate a canceled subscription
 */
export async function reactivateSubscription(
  workspaceId: string,
): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No subscription found");
  }

  // Remove cancel at period end
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "ACTIVE",
    },
  });
}

/**
 * Update subscription to a different plan
 */
export async function updateSubscriptionPlan({
  workspaceId,
  newPlanType,
}: {
  workspaceId: string;
  newPlanType: "PRO" | "MAX";
}): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active subscription found");
  }

  const planConfig = getPlanConfig(newPlanType) as any;

  if (!planConfig.stripePriceId) {
    throw new Error(`No Stripe price ID configured for ${newPlanType} plan`);
  }

  // Get the subscription from Stripe
  const stripeSubscription = await stripe.subscriptions.retrieve(
    subscription.stripeSubscriptionId,
  );

  // Update the subscription item
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [
      {
        id: stripeSubscription.items.data[0].id,
        price: planConfig.stripePriceId,
      },
    ],
    proration_behavior: "create_prorations",
  });

  // The webhook will handle updating the database
}

/**
 * Downgrade subscription to a lower plan (keeps credits until period end)
 */
export async function downgradeSubscription({
  workspaceId,
  newPlanType,
}: {
  workspaceId: string;
  newPlanType: "FREE" | "PRO";
}): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active subscription found");
  }

  // If downgrading to FREE, cancel at period end
  if (newPlanType === "FREE") {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELED",
      },
    });
    return;
  }

  // For paid-to-paid downgrades (e.g., MAX to PRO)
  const planConfig = getPlanConfig(newPlanType) as any;

  if (!planConfig.stripePriceId) {
    throw new Error(`No Stripe price ID configured for ${newPlanType} plan`);
  }

  // Get the subscription from Stripe
  const stripeSubscription = await stripe.subscriptions.retrieve(
    subscription.stripeSubscriptionId,
  );

  // Update subscription without proration, change takes effect at period end
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [
      {
        id: stripeSubscription.items.data[0].id,
        price: planConfig.stripePriceId,
      },
    ],
    proration_behavior: "none",
    billing_cycle_anchor: "unchanged",
  });

  // The webhook will handle updating the database at period end
}

/**
 * Create a one-time checkout session for a credit top-up.
 *
 * Top-ups are decoupled from the subscription: they use Stripe Checkout in
 * `payment` mode with a dynamic price_data line item. A pending CreditTopup
 * row is created up-front so the webhook can look it up idempotently by
 * `stripeCheckoutSessionId`.
 */
export async function createTopupCheckoutSession({
  workspaceId,
  userId,
  email,
  amountUsd,
  successUrl,
  cancelUrl,
}: {
  workspaceId: string;
  userId: string;
  email: string;
  amountUsd: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const validated = validateTopupAmount(amountUsd);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const customerId = await getOrCreateStripeCustomer(workspaceId, email);

  const topup = await prisma.creditTopup.create({
    data: {
      workspaceId,
      userId,
      amountUsd: validated.amountUsd,
      credits: validated.credits,
      status: "pending",
    },
  });

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: validated.amountUsd * 100,
          product_data: {
            name: `CORE credits top-up: ${validated.credits.toLocaleString()} credits`,
            description: `One-time purchase — credits never expire.`,
          },
        },
        quantity: 1,
      },
    ],
    allow_promotion_codes: false,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      type: "topup",
      topupId: topup.id,
      workspaceId,
      userId,
      credits: validated.credits.toString(),
      amountUsd: validated.amountUsd.toString(),
    },
    payment_intent_data: {
      metadata: {
        type: "topup",
        topupId: topup.id,
        workspaceId,
        userId,
      },
    },
  });

  await prisma.creditTopup.update({
    where: { id: topup.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return session.url!;
}

/**
 * Report usage for metered billing (overage)
 * Uses Stripe's new billing meter events API
 */
export async function reportUsage({
  workspaceId,
  overageCredits,
}: {
  workspaceId: string;
  overageCredits: number;
}): Promise<void> {
  if (!stripe || !isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription?.stripeCustomerId || !subscription.enableUsageBilling) {
    return; // No metered billing for this subscription
  }

  // Report usage using the new billing meter events API
  await stripe.billing.meterEvents.create({
    event_name: BILLING_CONFIG.stripe.meterEventName,
    payload: {
      value: overageCredits.toString(),
      stripe_customer_id: subscription.stripeCustomerId,
    },
  });
}
