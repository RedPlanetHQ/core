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
  },

  // Plan configurations
  plans: {
    free: {
      name: "Free",
      monthlyCredits: parseInt(process.env.FREE_PLAN_CREDITS || "500", 10),
      features: {
        episodesPerMonth: 200,
        searchesPerMonth: 200,
        mcpIntegrations: 3,
      },
    },
    pro: {
      name: "Pro",
      monthlyCredits: parseInt(process.env.PRO_PLAN_CREDITS || "2000", 10),
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

  // Credit costs per operation. `chatMessage` is the pre-flight minimum
  // (used by `hasCredits` to refuse turns for empty wallets); the real
  // charge for a chat turn is computed from actual input/output tokens via
  // `creditsForTokens` in ~/jobs/credit_utils.
  creditCosts: {
    addEpisode: parseInt(process.env.CREDIT_COST_EPISODE || "1", 10),
    search: parseInt(process.env.CREDIT_COST_SEARCH || "1", 10),
    chatMessage: parseInt(process.env.CREDIT_COST_CHAT || "1", 10),
  },

  // Token → credit conversion for chat/agent turns.
  // Defaults price 1 credit per 1K input tokens and 5 credits per 1K
  // output tokens, matching the typical 5× premium providers charge for
  // completion vs. prompt tokens.
  tokenCosts: {
    inputTokensPerCredit: parseInt(
      process.env.CREDIT_INPUT_TOKENS_PER_CREDIT || "1000",
      10,
    ),
    outputTokensPerCredit: parseInt(
      process.env.CREDIT_OUTPUT_TOKENS_PER_CREDIT || "200",
      10,
    ),
    minChatCredits: parseInt(process.env.CREDIT_MIN_CHAT || "1", 10),
  },

  // Billing cycle settings
  billingCycle: {
    // When to reset credits (1st of each month by default)
    resetDay: parseInt(process.env.BILLING_RESET_DAY || "1", 10),
  },

  // One-time credit top-ups. Available on every plan; credits never expire.
  topup: {
    minUsd: 10,
    incrementUsd: 10,
    creditsPerDollar: 100, // $10 -> 1000 credits
  },
} as const;

/**
 * Validate a top-up USD amount against the configured rules.
 * Returns the credit grant for a valid amount, or an error message.
 */
export function validateTopupAmount(
  amountUsd: number,
):
  | { ok: true; amountUsd: number; credits: number }
  | { ok: false; error: string } {
  const { minUsd, incrementUsd, creditsPerDollar } = BILLING_CONFIG.topup;
  if (!Number.isFinite(amountUsd) || !Number.isInteger(amountUsd)) {
    return { ok: false, error: "Amount must be a whole number of dollars" };
  }
  if (amountUsd < minUsd) {
    return { ok: false, error: `Minimum top-up is $${minUsd}` };
  }
  if (amountUsd % incrementUsd !== 0) {
    return {
      ok: false,
      error: `Amount must be a multiple of $${incrementUsd}`,
    };
  }
  return { ok: true, amountUsd, credits: amountUsd * creditsPerDollar };
}

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
