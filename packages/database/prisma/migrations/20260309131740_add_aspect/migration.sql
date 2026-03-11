-- CreateTable
CREATE TABLE "voice_aspects" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fact" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "episodeUuids" TEXT[],
    "validAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidAt" TIMESTAMP(3),
    "invalidatedBy" TEXT,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,

    CONSTRAINT "voice_aspects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_aspect_embeddings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fact" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "vector" vector NOT NULL,
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,

    CONSTRAINT "voice_aspect_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_aspects_userId_workspaceId_idx" ON "voice_aspects"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "voice_aspects_userId_aspect_idx" ON "voice_aspects"("userId", "aspect");

-- CreateIndex
CREATE INDEX "voice_aspects_userId_workspaceId_aspect_idx" ON "voice_aspects"("userId", "workspaceId", "aspect");

-- CreateIndex
CREATE INDEX "voice_aspects_invalidAt_idx" ON "voice_aspects"("invalidAt");

-- CreateIndex
CREATE INDEX "voice_aspect_embeddings_userId_workspaceId_idx" ON "voice_aspect_embeddings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "voice_aspect_embeddings_userId_workspaceId_aspect_idx" ON "voice_aspect_embeddings"("userId", "workspaceId", "aspect");

-- AddForeignKey
ALTER TABLE "voice_aspects" ADD CONSTRAINT "voice_aspects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_aspects" ADD CONSTRAINT "voice_aspects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_aspect_embeddings" ADD CONSTRAINT "voice_aspect_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_aspect_embeddings" ADD CONSTRAINT "voice_aspect_embeddings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
