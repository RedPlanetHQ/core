/*
  Warnings:

  - You are about to drop the column `lastSentAt` on the `Task` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[pageId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('Daily', 'Task');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "outlinks" JSONB DEFAULT '[]',
ADD COLUMN     "type" "PageType" NOT NULL DEFAULT 'Daily',
ALTER COLUMN "date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "lastSentAt";

-- CreateIndex
CREATE UNIQUE INDEX "Task_pageId_key" ON "Task"("pageId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
