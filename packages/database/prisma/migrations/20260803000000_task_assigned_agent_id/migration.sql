-- Add Task.assignedAgentId — nullable FK to Agents.
-- Records which agent (if any) currently owns the task's execution.
-- Nullable because pre-existing rows have no assignee, and human-only
-- tasks may never have one. When the agent row is deleted, the task's
-- assignment is cleared (SET NULL) — the task itself survives.

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "assignedAgentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Task"
    ADD CONSTRAINT "Task_assignedAgentId_fkey"
      FOREIGN KEY ("assignedAgentId") REFERENCES "Agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "Task_assignedAgentId_status_idx"
  ON "Task"("assignedAgentId", "status");
