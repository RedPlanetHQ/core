/*
  Warnings:

  - You are about to drop the column `labelIds` on the `IngestionQueue` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "IngestionQueue" DROP COLUMN "labelIds",
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];
