/*
  Warnings:

  - You are about to drop the `ConversationExecutionStep` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ConversationExecutionStep" DROP CONSTRAINT "ConversationExecutionStep_conversationHistoryId_fkey";

-- AlterTable
ALTER TABLE "ConversationHistory" ADD COLUMN     "parts" JSONB;

-- DropTable
DROP TABLE "ConversationExecutionStep";
