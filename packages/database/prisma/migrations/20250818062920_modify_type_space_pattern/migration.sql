-- AlterTable
ALTER TABLE "SpacePattern" ADD COLUMN     "editedSummary" TEXT,
ALTER COLUMN "userConfirmed" SET DEFAULT 'pending',
ALTER COLUMN "userConfirmed" SET DATA TYPE TEXT;
