-- AlterTable
ALTER TABLE "IngestionQueue" ADD COLUMN     "favourite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graphIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
