-- Add Conversation.agentId — nullable FK to Agents.
-- Records which agent "owns" the conversation (the WhatsApp-style single
-- endless thread per agent). Message-level attribution stays on
-- ConversationHistory.agentId — when the owning agent delegates, the child
-- message may be authored by a different agent, but the conversation
-- itself still belongs to the delegator.
--
-- Nullable because pre-existing conversations were created before agents
-- existed as a primitive. Deleting an agent leaves conversations intact
-- (SET NULL on delete).

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "agentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_agentId_idx"
  ON "Conversation"("workspaceId", "agentId");
