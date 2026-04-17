-- CreateTable
CREATE TABLE "CodingSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalSessionId" TEXT,
    "agent" TEXT NOT NULL,
    "prompt" TEXT,
    "dir" TEXT,
    "worktreePath" TEXT,
    "worktreeBranch" TEXT,
    "taskId" TEXT,
    "conversationId" TEXT,
    "gatewayId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CodingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodingSession_taskId_idx" ON "CodingSession"("taskId");

-- CreateIndex
CREATE INDEX "CodingSession_workspaceId_idx" ON "CodingSession"("workspaceId");

-- CreateIndex
CREATE INDEX "CodingSession_conversationId_idx" ON "CodingSession"("conversationId");

-- CreateIndex
CREATE INDEX "CodingSession_gatewayId_idx" ON "CodingSession"("gatewayId");

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingSession" ADD CONSTRAINT "CodingSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
