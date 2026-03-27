-- AlterTable
ALTER TABLE "IntegrationDefinitionV2" ADD COLUMN     "widgetUrl" TEXT;

-- AlterTable
ALTER TABLE "LLMModel" ADD COLUMN     "dimensions" INTEGER;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "widgetPat" TEXT;
