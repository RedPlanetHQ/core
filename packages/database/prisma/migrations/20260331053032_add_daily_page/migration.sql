-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "pageId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" TIMESTAMP(3),
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "descriptionBinary" BYTEA,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Page_workspaceId_userId_idx" ON "Page"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_workspaceId_userId_date_key" ON "Page"("workspaceId", "userId", "date");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
