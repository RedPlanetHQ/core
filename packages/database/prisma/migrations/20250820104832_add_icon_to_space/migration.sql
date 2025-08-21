/*
  Warnings:

  - You are about to drop the `Entity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SpaceEntity` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SpaceEntity" DROP CONSTRAINT "SpaceEntity_entityId_fkey";

-- DropForeignKey
ALTER TABLE "SpaceEntity" DROP CONSTRAINT "SpaceEntity_spaceId_fkey";

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "icon" TEXT;

-- DropTable
DROP TABLE "Entity";

-- DropTable
DROP TABLE "SpaceEntity";
