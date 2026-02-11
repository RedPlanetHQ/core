-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('CONNECTED', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "Gateway" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "status" "GatewayStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSeenAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "clientVersion" TEXT,
    "platform" TEXT,
    "hostname" TEXT,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Gateway_workspaceId_status_idx" ON "Gateway"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_workspaceId_name_key" ON "Gateway"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
