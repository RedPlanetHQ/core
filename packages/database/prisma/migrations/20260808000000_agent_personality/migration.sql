-- Per-agent personality (voice). Historically the workspace-wide voice
-- lived on User.metadata.personality; moving it onto Agents lets each
-- teammate (generalist, Cass, Alfred, etc.) sound different in the same
-- workspace. Default "tars" matches the prior workspace default so
-- existing rows keep behaving the same until an operator changes them.

ALTER TABLE "Agents"
  ADD COLUMN IF NOT EXISTS "personality" TEXT NOT NULL DEFAULT 'tars';

-- Backfill: for each workspace's generalist, adopt the personality set
-- by any user in that workspace whose metadata carries one. Skips the
-- workspace when nobody set a preference — the column default already
-- covers that case.
UPDATE "Agents" AS a
SET    "personality" = COALESCE(u."personality"::text, a."personality")
FROM   (
  SELECT DISTINCT ON ("workspaceId")
         "workspaceId",
         COALESCE(("metadata" -> 'personality')::text, NULL) AS "personality"
  FROM   "User"
  WHERE  ("metadata" -> 'personality') IS NOT NULL
  ORDER  BY "workspaceId", "createdAt" ASC
) AS u
WHERE  a."workspaceId" = u."workspaceId"
  AND  a."metadata" ->> 'role' = 'generalist'
  AND  u."personality" IS NOT NULL;

-- Strip JSON quotes that come out of the ->cast on TEXT-shaped values.
UPDATE "Agents"
SET    "personality" = TRIM(BOTH '"' FROM "personality")
WHERE  "personality" LIKE '"%"';
