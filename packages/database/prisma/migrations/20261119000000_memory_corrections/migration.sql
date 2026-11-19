-- Staged memory corrections: user- or agent-proposed changes to memory facts
-- (retire / correct), applied only after approval and reversible via restore.

-- CreateEnum
CREATE TYPE "MemoryCorrectionStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED', 'RESTORED');

-- CreateEnum
CREATE TYPE "MemoryCorrectionAction" AS ENUM ('RETIRE', 'CORRECT');

-- CreateTable
CREATE TABLE "memory_corrections" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "MemoryCorrectionStatus" NOT NULL DEFAULT 'PROPOSED',
    "action" "MemoryCorrectionAction" NOT NULL,
    "reason" TEXT,
    "correctedText" TEXT,
    "statementIds" TEXT[],
    "voiceAspectIds" TEXT[],
    "facts" JSONB NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "ingestionQueueId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "memory_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_corrections_workspaceId_status_createdAt_idx" ON "memory_corrections"("workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "memory_corrections" ADD CONSTRAINT "memory_corrections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_corrections" ADD CONSTRAINT "memory_corrections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

