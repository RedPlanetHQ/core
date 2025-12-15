-- CreateEnum
CREATE TYPE "WorkspaceVersion" AS ENUM ('V1', 'V2');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "version" "WorkspaceVersion" NOT NULL DEFAULT 'V1';
