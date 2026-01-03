-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'core';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "Document_sessionId_workspaceId_idx" ON "Document"("sessionId", "workspaceId");
