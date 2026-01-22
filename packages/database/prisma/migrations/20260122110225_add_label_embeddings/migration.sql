-- CreateTable
CREATE TABLE "label_embeddings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vector" vector NOT NULL,
    "metadata" JSONB,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "label_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_embeddings_workspaceId_idx" ON "label_embeddings"("workspaceId");
