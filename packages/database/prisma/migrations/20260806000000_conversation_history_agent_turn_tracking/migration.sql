-- Row-level lifecycle for agent-authored turns. Enables dispatchMentions to
-- (a) detect an in-flight turn for a given (conversation, agent) pair so a
-- fresh @mention of the same agent can cancel and supersede it, and
-- (b) bound agent↔agent mention fan-out via delegationDepth.
--
-- All columns nullable/defaulted so existing rows stay valid without a
-- backfill. status stays NULL on legacy rows and on user messages; only new
-- agent turns write it. asyncJobId holds the trigger.dev/BullMQ run id
-- while status='working' so `runs.cancel(asyncJobId)` can supersede.
-- deleted (already present) is what dispatchMentions sets when it soft-
-- cancels — the row stays for debug (e.g. "did the email actually send"
-- before we cancelled?").

ALTER TABLE "ConversationHistory"
  ADD COLUMN "status" TEXT,
  ADD COLUMN "asyncJobId" TEXT,
  ADD COLUMN "delegationDepth" INTEGER NOT NULL DEFAULT 0;

-- Race-guard lookup: "is agent A already working on conversation C?"
-- Partial index — most rows are done/null/user-authored, so we don't need
-- them in the index.
CREATE INDEX IF NOT EXISTS "ConversationHistory_conv_agent_status_idx"
  ON "ConversationHistory"("conversationId", "agentId", "status")
  WHERE "deleted" IS NULL;
