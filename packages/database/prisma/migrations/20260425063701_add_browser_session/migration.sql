-- CreateTable
CREATE TABLE "BrowserSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionName" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrowserSession_taskId_idx" ON "BrowserSession"("taskId");

-- CreateIndex
CREATE INDEX "BrowserSession_workspaceId_idx" ON "BrowserSession"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserSession_gatewayId_sessionName_key" ON "BrowserSession"("gatewayId", "sessionName");

-- AddForeignKey
ALTER TABLE "BrowserSession" ADD CONSTRAINT "BrowserSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserSession" ADD CONSTRAINT "BrowserSession_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserSession" ADD CONSTRAINT "BrowserSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
