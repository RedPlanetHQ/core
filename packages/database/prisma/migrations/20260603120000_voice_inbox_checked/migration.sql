-- VoiceInboxMessage: replace the delete-on-summarise model with an audit
-- column. Once a row has been caught up, we stamp `checked` = NOW() instead
-- of removing it, so we keep a history of what the user has heard and when.

ALTER TABLE "VoiceInboxMessage"
    ADD COLUMN "checked" TIMESTAMP(3);

-- Hot path: list unchecked rows for a user, oldest first. Partial index
-- (checked IS NULL) keeps the index small even as the table accumulates
-- history.
CREATE INDEX "VoiceInboxMessage_userId_unchecked_idx"
    ON "VoiceInboxMessage"("userId", "createdAt")
    WHERE "checked" IS NULL;
