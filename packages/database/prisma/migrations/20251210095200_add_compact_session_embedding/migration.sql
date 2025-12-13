/*
  Warnings:

  - You are about to drop the column `entityId` on the `entity_embeddings` table. All the data in the column will be lost.
  - You are about to drop the column `episodeId` on the `episode_embeddings` table. All the data in the column will be lost.
  - You are about to drop the column `statementId` on the `statement_embeddings` table. All the data in the column will be lost.

*/

-- DropIndex
DROP INDEX "entity_embeddings_entityId_idx";

-- DropIndex
DROP INDEX "entity_embeddings_entityId_key";

-- DropIndex
DROP INDEX "episode_embeddings_episodeId_idx";

-- DropIndex
DROP INDEX "episode_embeddings_episodeId_key";

-- DropIndex
DROP INDEX "statement_embeddings_statementId_idx";

-- DropIndex
DROP INDEX "statement_embeddings_statementId_key";

-- AlterTable
ALTER TABLE "entity_embeddings" DROP COLUMN "entityId";

-- AlterTable
ALTER TABLE "episode_embeddings" DROP COLUMN "episodeId";

-- AlterTable
ALTER TABLE "statement_embeddings" DROP COLUMN "statementId";

-- CreateTable
CREATE TABLE "compacted_session_embeddings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vector" vector NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "compacted_session_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compacted_session_embeddings_userId_key" ON "compacted_session_embeddings"("userId");

-- CreateIndex
CREATE INDEX "compacted_session_embeddings_userId_idx" ON "compacted_session_embeddings"("userId");

-- AddForeignKey
ALTER TABLE "compacted_session_embeddings" ADD CONSTRAINT "compacted_session_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
