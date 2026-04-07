-- Reassign displayId when parentTaskId is set for the first time (NULL → value).
-- Handles two-step creation patterns where a task is inserted without parentTaskId
-- and then updated to link it to a parent.

CREATE OR REPLACE FUNCTION reassign_task_display_id_on_reparent()
RETURNS TRIGGER AS $$
DECLARE
  seq_name          TEXT;
  next_n            INT;
  parent_display_id TEXT;
BEGIN
  SELECT "displayId" INTO parent_display_id
  FROM "Task"
  WHERE id = NEW."parentTaskId";

  seq_name := 'task_child_seq_' || replace(NEW."parentTaskId", '-', '_');
  EXECUTE FORMAT('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', seq_name);
  EXECUTE FORMAT('SELECT nextval(%L)', seq_name) INTO next_n;
  NEW."displayId" := COALESCE(parent_display_id, 'tk-?????') || '.' || next_n;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reassign_task_display_id
BEFORE UPDATE ON "Task"
FOR EACH ROW
WHEN (OLD."parentTaskId" IS NULL AND NEW."parentTaskId" IS NOT NULL)
EXECUTE FUNCTION reassign_task_display_id_on_reparent();
