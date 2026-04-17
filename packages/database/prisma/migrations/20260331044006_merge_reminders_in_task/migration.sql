-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'Recurring';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "confirmedActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "maxOccurrences" INTEGER,
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "schedule" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "unrespondedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Task_nextRunAt_idx" ON "Task"("nextRunAt");

-- CreateIndex
CREATE INDEX "Task_isActive_idx" ON "Task"("isActive");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "Task_workspaceId_isActive_nextRunAt_idx" ON "Task"("workspaceId", "isActive", "nextRunAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
