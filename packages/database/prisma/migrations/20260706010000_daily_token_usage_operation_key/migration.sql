-- New source category for non-user-facing LLM work (title generation,
-- session compaction, reranking, etc.) — recorded per-call from
-- makeModelCall / makeStructuredModelCall.
ALTER TYPE "TokenUsageSource" ADD VALUE 'background';

-- Add operationKey column so per-prompt drilldown works (breaks down
-- reflect-world vs extract-voice vs conversationTitle, etc.).
ALTER TABLE "DailyTokenUsage" ADD COLUMN "operationKey" TEXT NOT NULL DEFAULT '';

-- Allow null userId for background/system LLM calls that don't have a
-- per-user actor (attributed at the workspace level instead).
ALTER TABLE "DailyTokenUsage" ALTER COLUMN "userId" DROP NOT NULL;

-- Rebuild the unique constraint to include operationKey. Use NULLS NOT
-- DISTINCT (Postgres 15+) so null-userId rows still dedupe on the bucket
-- key instead of piling up duplicates.
DROP INDEX "DailyTokenUsage_date_userId_workspaceId_source_model_key";
CREATE UNIQUE INDEX "DailyTokenUsage_date_userId_workspaceId_source_model_operat_key" ON "DailyTokenUsage"("date", "userId", "workspaceId", "source", "model", "operationKey") NULLS NOT DISTINCT;
