/*
  Warnings:

  - Added the required column `name` to the `SpacePattern` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SpacePattern" ADD COLUMN     "name" TEXT NOT NULL;
