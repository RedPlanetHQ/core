-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('Researching', 'Active', 'Hidden');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('Auto', 'Manual');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityUuid" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company" TEXT,
    "role" TEXT,
    "location" TEXT,
    "handles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headline" TEXT,
    "description" TEXT,
    "descriptionEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "status" "ContactStatus" NOT NULL DEFAULT 'Researching',
    "source" "ContactSource" NOT NULL DEFAULT 'Auto',
    "lastMemoryAt" TIMESTAMP(3),
    "lastSummarizedAt" TIMESTAMP(3),
    "avatarUrl" TEXT,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_entityUuid_key" ON "Contact"("workspaceId", "entityUuid");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_status_idx" ON "Contact"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
