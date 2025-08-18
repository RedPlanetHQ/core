-- CreateTable
CREATE TABLE "SpacePattern" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "spaceId" TEXT NOT NULL,

    CONSTRAINT "SpacePattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpacePattern_spaceId_source_idx" ON "SpacePattern"("spaceId", "source");

-- AddForeignKey
ALTER TABLE "SpacePattern" ADD CONSTRAINT "SpacePattern_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
