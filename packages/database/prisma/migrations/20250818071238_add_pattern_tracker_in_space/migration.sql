-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "lastPatternTrigger" TIMESTAMP(3),
ADD COLUMN     "statementCountAtLastTrigger" INTEGER;
