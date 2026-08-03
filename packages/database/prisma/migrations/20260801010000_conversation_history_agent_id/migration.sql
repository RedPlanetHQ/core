-- Add ConversationHistory.agentId — nullable FK to Agents.
-- Records which agent authored an agent-role message. Nullable because
-- pre-existing rows have no agent identity beyond userType=Agent, and
-- because system/synthetic rows may not correspond to a stored agent.
-- Deleting an agent leaves history intact (SET NULL on delete).

ALTER TABLE "ConversationHistory"
  ADD COLUMN IF NOT EXISTS "agentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ConversationHistory"
    ADD CONSTRAINT "ConversationHistory_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "ConversationHistory_agentId_idx"
  ON "ConversationHistory"("agentId");
