-- Add displayId column
ALTER TABLE "Task" ADD COLUMN "displayId" TEXT;
CREATE UNIQUE INDEX "Task_workspaceId_displayId_key" ON "Task"("workspaceId", "displayId");
CREATE INDEX "Task_workspaceId_displayId_idx" ON "Task"("workspaceId", "displayId");

-- ============================================================================
-- Helper: get or create parent-scoped sequence for child tasks
-- ============================================================================
CREATE OR REPLACE FUNCTION get_child_task_sequence(parent_id TEXT)
RETURNS TEXT AS $$
DECLARE
  seq_name TEXT;
BEGIN
  seq_name := 'task_child_seq_' || replace(parent_id, '-', '_');
  EXECUTE FORMAT('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', seq_name);
  RETURN seq_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger function: assign displayId on INSERT
-- ============================================================================
CREATE OR REPLACE FUNCTION assign_task_display_id()
RETURNS TRIGGER AS $$
DECLARE
  seq_name          TEXT;
  next_n            INT;
  parent_display_id TEXT;
  new_id            TEXT;
BEGIN
  IF NEW."displayId" IS NULL THEN
    IF NEW."parentTaskId" IS NULL THEN
      -- Root task: random 5-letter id, retry on collision within workspace
      LOOP
        new_id := 'tk-' || (
          SELECT string_agg(chr(97 + floor(random() * 26)::int), '')
          FROM generate_series(1, 5)
        );
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM "Task"
          WHERE "workspaceId" = NEW."workspaceId"
            AND "displayId" = new_id
        );
      END LOOP;
      NEW."displayId" := new_id;
    ELSE
      -- Child task: parent-scoped sequence → parentDisplayId.1, .2 …
      SELECT "displayId" INTO parent_display_id
      FROM "Task"
      WHERE id = NEW."parentTaskId";

      seq_name := get_child_task_sequence(NEW."parentTaskId");
      EXECUTE FORMAT('SELECT nextval(%L)', seq_name) INTO next_n;
      NEW."displayId" := COALESCE(parent_display_id, 'tk-?????') || '.' || next_n;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Attach trigger
-- ============================================================================
CREATE TRIGGER set_task_display_id
BEFORE INSERT ON "Task"
FOR EACH ROW
WHEN (NEW."displayId" IS NULL)
EXECUTE FUNCTION assign_task_display_id();
