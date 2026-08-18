-- Keyset pagination index for conversation history.
--
-- The chat UI no longer loads a whole thread: it reads the newest page and
-- walks backwards with a (createdAt, id) cursor. Both the initial read and
-- every "load older" step order by that exact tuple scoped to one
-- conversation, so without this index each page is a sort over every row in
-- the thread — which for an integration-fed source grows without bound.
--
-- `id` is in the index because createdAt alone isn't unique: rows written in
-- the same millisecond would otherwise straddle a page boundary and get
-- duplicated or dropped.

CREATE INDEX IF NOT EXISTS "ConversationHistory_conversationId_createdAt_id_idx"
  ON "ConversationHistory"("conversationId", "createdAt", "id");
