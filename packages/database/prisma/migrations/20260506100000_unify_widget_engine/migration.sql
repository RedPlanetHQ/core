-- CreateEnum
CREATE TYPE "WidgetEngine" AS ENUM ('DECLARATIVE', 'BUNDLED');

-- AlterTable: add engine + bundled metadata, make spec nullable
ALTER TABLE "Widget" ADD COLUMN "engine" "WidgetEngine" NOT NULL DEFAULT 'DECLARATIVE';
ALTER TABLE "Widget" ADD COLUMN "integrationAccountId" TEXT;
ALTER TABLE "Widget" ADD COLUMN "bundledWidgetSlug" TEXT;
ALTER TABLE "Widget" ADD COLUMN "configValues" JSONB;
ALTER TABLE "Widget" ALTER COLUMN "spec" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Widget_engine_idx" ON "Widget"("engine");
CREATE INDEX "Widget_integrationAccountId_idx" ON "Widget"("integrationAccountId");

-- AddForeignKey
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_integrationAccountId_fkey" FOREIGN KEY ("integrationAccountId") REFERENCES "IntegrationAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
