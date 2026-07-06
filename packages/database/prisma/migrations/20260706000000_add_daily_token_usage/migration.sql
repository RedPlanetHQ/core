-- CreateEnum
CREATE TYPE "TokenUsageSource" AS ENUM ('memory_ingestion', 'conversation', 'task_conversation');

-- CreateTable: per-day rollup of LLM token consumption by source
CREATE TABLE "DailyTokenUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "date" DATE NOT NULL,
    "source" "TokenUsageSource" NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DailyTokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyTokenUsage_date_userId_workspaceId_source_model_key" ON "DailyTokenUsage"("date", "userId", "workspaceId", "source", "model");

-- CreateIndex
CREATE INDEX "DailyTokenUsage_workspaceId_date_idx" ON "DailyTokenUsage"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "DailyTokenUsage_userId_date_idx" ON "DailyTokenUsage"("userId", "date");

-- AddForeignKey
ALTER TABLE "DailyTokenUsage" ADD CONSTRAINT "DailyTokenUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTokenUsage" ADD CONSTRAINT "DailyTokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
