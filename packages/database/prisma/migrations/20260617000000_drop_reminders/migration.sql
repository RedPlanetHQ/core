-- Drop the Reminder feature. Scheduling/recurrence has moved to Task with
-- its own scheduling fields; the Reminder model + queue + agent tools are
-- gone. This migration tears down the table and its foreign key.

ALTER TABLE "Reminder" DROP CONSTRAINT IF EXISTS "Reminder_workspaceId_fkey";

ALTER TABLE "Reminder" DROP CONSTRAINT IF EXISTS "Reminder_channelId_fkey";

DROP TABLE IF EXISTS "Reminder";
