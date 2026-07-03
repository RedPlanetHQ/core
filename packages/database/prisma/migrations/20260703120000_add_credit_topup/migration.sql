-- AlterTable: add persistent, non-expiring top-up credit bucket
ALTER TABLE "UserUsage" ADD COLUMN "topupCredits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: audit trail of credit top-up purchases
CREATE TABLE "CreditTopup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amountUsd" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CreditTopup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopup_stripeCheckoutSessionId_key" ON "CreditTopup"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopup_stripePaymentIntentId_key" ON "CreditTopup"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "CreditTopup_workspaceId_createdAt_idx" ON "CreditTopup"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTopup_userId_createdAt_idx" ON "CreditTopup"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditTopup" ADD CONSTRAINT "CreditTopup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTopup" ADD CONSTRAINT "CreditTopup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
