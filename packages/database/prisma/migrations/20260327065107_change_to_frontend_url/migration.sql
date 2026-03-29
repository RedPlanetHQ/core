/*
  Warnings:

  - You are about to drop the column `widgetUrl` on the `IntegrationDefinitionV2` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "IntegrationDefinitionV2" DROP COLUMN "widgetUrl",
ADD COLUMN     "frontendUrl" TEXT;
