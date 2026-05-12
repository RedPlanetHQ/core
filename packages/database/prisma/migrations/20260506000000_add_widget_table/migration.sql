-- CreateEnum
CREATE TYPE "WidgetKind" AS ENUM ('DEFAULT', 'USER');

-- CreateTable
CREATE TABLE "Widget" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" TIMESTAMP(3),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "kind" "WidgetKind" NOT NULL DEFAULT 'USER',
    "spec" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" JSONB,
    "sourceSlug" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,

    CONSTRAINT "Widget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Widget_kind_idx" ON "Widget"("kind");

-- CreateIndex
CREATE INDEX "Widget_workspaceId_userId_idx" ON "Widget"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Widget_workspaceId_userId_slug_key" ON "Widget"("workspaceId", "userId", "slug");

-- AddForeignKey
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
