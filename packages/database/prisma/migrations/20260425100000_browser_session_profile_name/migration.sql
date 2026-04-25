-- AlterTable: add profileName, backfilling from sessionName for existing rows.
-- Rows are short-lived (one row per active task's browser use), so a
-- defensive default-to-self backfill is harmless even if rows linger.
ALTER TABLE "BrowserSession" ADD COLUMN "profileName" TEXT;
UPDATE "BrowserSession" SET "profileName" = "sessionName" WHERE "profileName" IS NULL;
ALTER TABLE "BrowserSession" ALTER COLUMN "profileName" SET NOT NULL;

-- CreateIndex: lock query is keyed on (gatewayId, profileName) since the
-- profile is the actually-exclusive resource (Chromium SingletonLock).
CREATE INDEX "BrowserSession_gatewayId_profileName_idx" ON "BrowserSession"("gatewayId", "profileName");
