-- Sequential per-workspace and per-parent counters for Task displayIds.
-- Replaces dynamic per-parent SEQUENCE objects (which were not concurrency-safe
-- under CREATE SEQUENCE IF NOT EXISTS) and the random root-id retry loop.
--
-- Existing tk-<5-letters> root IDs are preserved as-is. New roots get tk-1,
-- tk-2, ... per workspace. Old IDs cannot collide with new IDs because
-- old IDs contain only letters and new IDs are pure digits.

-- ============================================================================
-- 1. Counter columns
-- ============================================================================
ALTER TABLE "Workspace" ADD COLUMN "taskRootCounter" INT NOT NULL DEFAULT 0;
ALTER TABLE "Task"      ADD COLUMN "childCount"      INT NOT NULL DEFAULT 0;

-- ============================================================================
-- 2. Backfill Task.childCount for existing parents
--    childCount stores the LAST issued child suffix; trigger does +1 on insert.
--    Use GREATEST(MAX_parsed_suffix, COUNT) so suffix gaps from prior deletes
--    do not cause the next allocation to collide on the unique index.
-- ============================================================================
UPDATE "Task" parent
SET "childCount" = sub.cnt
FROM (
  SELECT
    c."parentTaskId",
    GREATEST(
      COALESCE(MAX((regexp_match(c."displayId", '\.(\d+)$'))[1]::int), 0),
      COUNT(*)
    ) AS cnt
  FROM "Task" c
  WHERE c."parentTaskId" IS NOT NULL
  GROUP BY c."parentTaskId"
) sub
WHERE parent.id = sub."parentTaskId";

-- ============================================================================
-- 3. Replace the INSERT trigger function
--    Roots: per-workspace counter on Workspace.taskRootCounter
--    Children: per-parent counter on Task.childCount, parent displayId fetched
--    in the same UPDATE...RETURNING for atomicity.
--    RAISE EXCEPTION on null parent displayId rather than silently fabricating
--    a 'tk-?' value.
-- ============================================================================
CREATE OR REPLACE FUNCTION assign_task_display_id()
RETURNS TRIGGER AS $func$
DECLARE
  next_n            INT;
  parent_display_id TEXT;
BEGIN
  IF NEW."displayId" IS NULL THEN
    IF NEW."parentTaskId" IS NULL THEN
      UPDATE "Workspace"
      SET "taskRootCounter" = "taskRootCounter" + 1
      WHERE id = NEW."workspaceId"
      RETURNING "taskRootCounter" INTO next_n;

      IF next_n IS NULL THEN
        RAISE EXCEPTION 'Workspace % not found when assigning root displayId', NEW."workspaceId";
      END IF;

      NEW."displayId" := 'tk-' || next_n;
    ELSE
      UPDATE "Task"
      SET "childCount" = "childCount" + 1
      WHERE id = NEW."parentTaskId"
      RETURNING "childCount", "displayId" INTO next_n, parent_display_id;

      IF next_n IS NULL THEN
        RAISE EXCEPTION 'Parent task % not found when assigning child displayId', NEW."parentTaskId";
      END IF;

      IF parent_display_id IS NULL THEN
        RAISE EXCEPTION 'Parent task % has NULL displayId', NEW."parentTaskId";
      END IF;

      NEW."displayId" := parent_display_id || '.' || next_n;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Replace the BEFORE UPDATE reparent trigger function (NULL -> NOT NULL)
-- ============================================================================
CREATE OR REPLACE FUNCTION reassign_task_display_id_on_reparent()
RETURNS TRIGGER AS $func$
DECLARE
  next_n            INT;
  parent_display_id TEXT;
BEGIN
  UPDATE "Task"
  SET "childCount" = "childCount" + 1
  WHERE id = NEW."parentTaskId"
  RETURNING "childCount", "displayId" INTO next_n, parent_display_id;

  IF next_n IS NULL THEN
    RAISE EXCEPTION 'Parent task % not found when reassigning displayId', NEW."parentTaskId";
  END IF;

  IF parent_display_id IS NULL THEN
    RAISE EXCEPTION 'Parent task % has NULL displayId', NEW."parentTaskId";
  END IF;

  NEW."displayId" := parent_display_id || '.' || next_n;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Drop the obsolete sequence helper
-- ============================================================================
DROP FUNCTION IF EXISTS get_child_task_sequence(TEXT);

-- ============================================================================
-- 6. Drop orphan task_child_seq_* sequences left behind by the previous design
-- ============================================================================
DO $cleanup$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND c.relname LIKE 'task_child_seq_%'
      AND n.nspname = current_schema()
  LOOP
    EXECUTE FORMAT('DROP SEQUENCE IF EXISTS %I', r.seqname);
  END LOOP;
END $cleanup$;
