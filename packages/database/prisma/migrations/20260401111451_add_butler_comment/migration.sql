

-- CreateTable
CREATE TABLE "ButlerComment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "selectedText" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "ButlerComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ButlerComment_pageId_resolved_idx" ON "ButlerComment"("pageId", "resolved");

-- AddForeignKey
ALTER TABLE "ButlerComment" ADD CONSTRAINT "ButlerComment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ButlerComment" ADD CONSTRAINT "ButlerComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
