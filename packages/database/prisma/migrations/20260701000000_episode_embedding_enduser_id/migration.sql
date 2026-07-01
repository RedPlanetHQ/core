-- AlterTable
ALTER TABLE "episode_embeddings" ADD COLUMN "endUserId" TEXT;

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_workspaceId_endUserId_idx" ON "episode_embeddings"("userId", "workspaceId", "endUserId");

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "endUserId" TEXT;

-- CreateIndex
CREATE INDEX "Document_workspaceId_endUserId_idx" ON "Document"("workspaceId", "endUserId");
