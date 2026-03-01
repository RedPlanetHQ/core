-- CreateTable
CREATE TABLE "BackgroundTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "intent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "timeoutMs" INTEGER NOT NULL DEFAULT 1800000,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "error" TEXT,
    "callbackChannel" TEXT NOT NULL,
    "callbackConversationId" TEXT,
    "callbackMetadata" JSONB,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "BackgroundTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundTask_workspaceId_idx" ON "BackgroundTask"("workspaceId");

-- CreateIndex
CREATE INDEX "BackgroundTask_workspaceId_status_idx" ON "BackgroundTask"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "BackgroundTask_userId_status_idx" ON "BackgroundTask"("userId", "status");

-- AddForeignKey
ALTER TABLE "BackgroundTask" ADD CONSTRAINT "BackgroundTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
