-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "chunkHashes" TEXT[],
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "episode_embeddings" ADD COLUMN     "chunkHash" TEXT,
ADD COLUMN     "chunkIndex" INTEGER,
ADD COLUMN     "originalContent" TEXT,
ADD COLUMN     "version" INTEGER;

-- CreateIndex
CREATE INDEX "Document_workspaceId_idx" ON "Document"("workspaceId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_sessionId_version_idx" ON "episode_embeddings"("userId", "sessionId", "version");
