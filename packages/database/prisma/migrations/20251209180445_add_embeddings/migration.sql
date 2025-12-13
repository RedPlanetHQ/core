CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA core;

-- CreateTable
CREATE TABLE "statement_embeddings" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "vector" vector NOT NULL,
    "labelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statement_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_embeddings" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vector" vector NOT NULL,
    "labelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_embeddings" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vector" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statement_embeddings_statementId_key" ON "statement_embeddings"("statementId");

-- CreateIndex
CREATE INDEX "statement_embeddings_userId_idx" ON "statement_embeddings"("userId");

-- CreateIndex
CREATE INDEX "statement_embeddings_statementId_idx" ON "statement_embeddings"("statementId");

-- CreateIndex
CREATE INDEX "statement_embeddings_userId_labelIds_idx" ON "statement_embeddings"("userId", "labelIds");

-- CreateIndex
CREATE UNIQUE INDEX "episode_embeddings_episodeId_key" ON "episode_embeddings"("episodeId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_idx" ON "episode_embeddings"("userId");

-- CreateIndex
CREATE INDEX "episode_embeddings_episodeId_idx" ON "episode_embeddings"("episodeId");

-- CreateIndex
CREATE INDEX "episode_embeddings_userId_labelIds_idx" ON "episode_embeddings"("userId", "labelIds");

-- CreateIndex
CREATE UNIQUE INDEX "entity_embeddings_entityId_key" ON "entity_embeddings"("entityId");

-- CreateIndex
CREATE INDEX "entity_embeddings_userId_idx" ON "entity_embeddings"("userId");

-- CreateIndex
CREATE INDEX "entity_embeddings_entityId_idx" ON "entity_embeddings"("entityId");

-- AddForeignKey
ALTER TABLE "statement_embeddings" ADD CONSTRAINT "statement_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_embeddings" ADD CONSTRAINT "episode_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_embeddings" ADD CONSTRAINT "entity_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: HNSW indexes are created at application startup based on EMBEDDING_DIMENSION env var
-- This allows users to configure their own embedding model dimensions (1536, 3072, etc.)
-- The indexes are created with: CREATE INDEX IF NOT EXISTS ... USING hnsw ((vector::vector(DIMENSION)) vector_cosine_ops)
