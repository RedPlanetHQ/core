-- Drop overage-billing columns. Credits are now bought via one-time top-ups
-- (`CreditTopup`), so metered overage is no longer part of the model.

-- AlterTable
ALTER TABLE "BillingHistory"
  DROP COLUMN IF EXISTS "overageCreditsUsed",
  DROP COLUMN IF EXISTS "usageAmount";

-- AlterTable
ALTER TABLE "Subscription"
  DROP COLUMN IF EXISTS "enableUsageBilling",
  DROP COLUMN IF EXISTS "usagePricePerCredit",
  DROP COLUMN IF EXISTS "overageCreditsUsed",
  DROP COLUMN IF EXISTS "overageAmount";

-- AlterTable
ALTER TABLE "UserUsage"
  DROP COLUMN IF EXISTS "overageCredits";
