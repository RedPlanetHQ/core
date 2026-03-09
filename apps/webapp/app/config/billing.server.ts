/**
 * Billing Configuration
 *
 * This file centralizes all billing-related configuration.
 * Billing is feature-flagged and can be disabled for self-hosted instances.
 */

export const BILLING_CONFIG = {
  // Feature flag: Enable/disable billing system
  // Self-hosted instances can set this to false for unlimited usage
  enabled: process.env.ENABLE_BILLING === "true",

  // Stripe configuration (only used if billing is enabled)
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    meterEventName: process.env.STRIPE_METER_EVENT_NAME || "echo_credits_used",
  },

  // Plan configurations
  plans: {
    free: {
      name: "Free",
      monthlyCredits: parseInt(process.env.FREE_PLAN_CREDITS || "200", 10),
      enableOverage: false,
      features: {
        episodesPerMonth: 200,
        searchesPerMonth: 200,
        mcpIntegrations: 3,
      },
    },
    pro: {
      name: "Pro",
      monthlyCredits: parseInt(process.env.PRO_PLAN_CREDITS || "2000", 10),
      enableOverage: true,
      overagePrice: parseFloat(process.env.PRO_OVERAGE_PRICE || "0.01"), // $0.01 per credit
      stripePriceId: process.env.PRO_PLAN_STRIPE_PRICE_ID,
      features: {
        episodesPerMonth: 2000,
        searchesPerMonth: 2000,
        mcpIntegrations: -1, // unlimited
        prioritySupport: true,
      },
    },
    max: {
      name: "Max",
      monthlyCredits: parseInt(process.env.MAX_PLAN_CREDITS || "10000", 10),
      enableOverage: true,
      overagePrice: parseFloat(process.env.MAX_OVERAGE_PRICE || "0.008"), // $0.008 per credit (cheaper than pro)
      stripePriceId: process.env.MAX_PLAN_STRIPE_PRICE_ID,
      features: {
        episodesPerMonth: 10000,
        searchesPerMonth: 10000,
        mcpIntegrations: -1, // unlimited
        prioritySupport: true,
        customIntegrations: true,
        dedicatedSupport: true,
      },
    },
  },

  // Credit costs per operation
  creditCosts: {
    addEpisode: parseInt(process.env.CREDIT_COST_EPISODE || "1", 10),
    search: parseInt(process.env.CREDIT_COST_SEARCH || "1", 10),
    chatMessage: parseInt(process.env.CREDIT_COST_CHAT || "1", 10),
  },

  // Billing cycle settings
  billingCycle: {
    // When to reset credits (1st of each month by default)
    resetDay: parseInt(process.env.BILLING_RESET_DAY || "1", 10),
  },
} as const;

/**
 * Get plan configuration by plan type
 */
export function getPlanConfig(planType: "FREE" | "PRO" | "MAX") {
  return BILLING_CONFIG.plans[
    planType.toLowerCase() as keyof typeof BILLING_CONFIG.plans
  ];
}

/**
 * Check if billing is enabled
 */
export function isBillingEnabled(): boolean {
  return BILLING_CONFIG.enabled;
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!(
    BILLING_CONFIG.stripe.secretKey && BILLING_CONFIG.stripe.publishableKey
  );
}

/**
 * Validate billing configuration
 */
export function validateBillingConfig() {
  if (!BILLING_CONFIG.enabled) {
    console.log(
      "ℹ️  Billing is disabled. Running in self-hosted mode with unlimited credits.",
    );
    return;
  }

  if (!isStripeConfigured()) {
    console.warn(
      "⚠️  ENABLE_BILLING is true but Stripe is not configured. Billing will not work.",
    );
  }

  console.log("✅ Billing is enabled with Stripe integration");
}

/**
 * Check if a plan type is a paid plan (PRO or MAX)
 */
export function isPaidPlan(planType: "FREE" | "PRO" | "MAX"): boolean {
  return planType === "PRO" || planType === "MAX";
}
