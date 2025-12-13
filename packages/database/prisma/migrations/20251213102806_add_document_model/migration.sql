/*
  Warnings:

  - Added the required column `ingestionQueueId` to the `episode_embeddings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sessionId` to the `episode_embeddings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "episode_embeddings" ADD COLUMN     "ingestionQueueId" TEXT NOT NULL,
ADD COLUMN     "sessionId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "labelIds" TEXT[],
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "type" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_sessionId_idx" ON "episode_embeddings"("userId", "sessionId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_embeddings" ADD CONSTRAINT "episode_embeddings_ingestionQueueId_fkey" FOREIGN KEY ("ingestionQueueId") REFERENCES "IngestionQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
