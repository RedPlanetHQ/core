-- Consolidate topupCredits into availableCredits.
-- Top-ups now increment availableCredits directly; the separate topup
-- bucket is removed. Fold any existing top-up balance into availableCredits
-- first so no one loses paid credits, then drop the column.

UPDATE "UserUsage"
   SET "availableCredits" = "availableCredits" + "topupCredits"
 WHERE "topupCredits" > 0;

ALTER TABLE "UserUsage" DROP COLUMN IF EXISTS "topupCredits";
