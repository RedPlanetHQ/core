-- AlterTable: add per-widget request cache column
ALTER TABLE "Widget" ADD COLUMN "cache" JSONB;
