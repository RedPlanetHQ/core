/*
  Warnings:

  - You are about to drop the column `backgroundTaskId` on the `Conversation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "backgroundTaskId",
ADD COLUMN     "asyncJobId" TEXT;
