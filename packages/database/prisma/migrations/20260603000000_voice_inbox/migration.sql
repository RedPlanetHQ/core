-- VoiceInboxMessage: per-user bucket of agent send_message outputs.
-- Backs the Mac voice pill: count is shown as a badge, "click to summarise"
-- pulls these rows, runs them through the summarise service, then deletes.

CREATE TABLE "VoiceInboxMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "taskId" TEXT,
    "message" TEXT NOT NULL,
    "channelType" TEXT,

    CONSTRAINT "VoiceInboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoiceInboxMessage_userId_createdAt_idx"
    ON "VoiceInboxMessage"("userId", "createdAt");

ALTER TABLE "VoiceInboxMessage"
    ADD CONSTRAINT "VoiceInboxMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceInboxMessage"
    ADD CONSTRAINT "VoiceInboxMessage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceInboxMessage"
    ADD CONSTRAINT "VoiceInboxMessage_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
