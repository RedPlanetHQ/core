-- CreateIndex
CREATE INDEX "IngestionQueue_workspaceId_sessionId_idx" ON "IngestionQueue"("workspaceId", "sessionId");
