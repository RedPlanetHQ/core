-- Index for per-(task, agent) conversation lookups. asyncJobId already stores
-- the task id when the conversation is task-scoped; pairing it with agentId
-- lets `getOrCreateTaskConversation(taskId, agentId)` resolve without a
-- sequential scan when many task threads share the same agent or the same
-- task.

CREATE INDEX IF NOT EXISTS "Conversation_asyncJobId_agentId_idx"
  ON "Conversation"("asyncJobId", "agentId");
