-- DropIndex
DROP INDEX "entity_embeddings_userId_idx";

-- DropIndex
DROP INDEX "episode_embeddings_userId_idx";

-- DropIndex
DROP INDEX "episode_embeddings_userId_labelIds_idx";

-- DropIndex
DROP INDEX "episode_embeddings_userId_sessionId_idx";

-- DropIndex
DROP INDEX "episode_embeddings_userId_sessionId_version_idx";

-- DropIndex
DROP INDEX "statement_embeddings_userId_idx";

-- DropIndex
DROP INDEX "statement_embeddings_userId_labelIds_idx";

-- AlterTable
ALTER TABLE "entity_embeddings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "episode_embeddings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "statement_embeddings" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "entity_embeddings_userId_workspaceId_idx" ON "entity_embeddings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_workspaceId_idx" ON "episode_embeddings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_workspaceId_labelIds_idx" ON "episode_embeddings"("userId", "workspaceId", "labelIds");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_workspaceId_sessionId_idx" ON "episode_embeddings"("userId", "workspaceId", "sessionId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_workspaceId_sessionId_version_idx" ON "episode_embeddings"("userId", "workspaceId", "sessionId", "version");

-- CreateIndex
CREATE INDEX "statement_embeddings_userId_workspaceId_idx" ON "statement_embeddings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "statement_embeddings_userId_workspaceId_labelIds_idx" ON "statement_embeddings"("userId", "workspaceId", "labelIds");

-- AddForeignKey
ALTER TABLE "entity_embeddings" ADD CONSTRAINT "entity_embeddings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_embeddings" ADD CONSTRAINT "episode_embeddings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_embeddings" ADD CONSTRAINT "statement_embeddings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
