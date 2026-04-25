/*
  Warnings:

  - Added the required column `baseUrl` to the `Gateway` table without a default value. This is not possible if the table is not empty.
  - Added the required column `encryptedSecurityKey` to the `Gateway` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "baseUrl" TEXT NOT NULL,
ADD COLUMN     "encryptedSecurityKey" JSONB NOT NULL,
ADD COLUMN     "lastHealthError" TEXT,
ADD COLUMN     "manifest" JSONB,
ADD COLUMN     "manifestEtag" TEXT;
