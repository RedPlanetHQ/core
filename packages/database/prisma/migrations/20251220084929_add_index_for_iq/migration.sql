-- CreateIndex
CREATE INDEX "IngestionQueue_workspaceId_sessionId_createdAt_idx" ON "IngestionQueue"("workspaceId", "sessionId", "createdAt" DESC);
