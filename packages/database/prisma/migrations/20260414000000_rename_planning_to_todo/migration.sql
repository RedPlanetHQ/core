/*
  Warnings:

  - The values [Backlog,Planning] on the enum `TaskStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TaskStatus_new" AS ENUM ('Todo', 'Waiting', 'Ready', 'Working', 'Review', 'Done', 'Recurring');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus_new" USING (
  CASE "status"::text
    WHEN 'Backlog'   THEN 'Todo'
    WHEN 'Planning'  THEN 'Todo'
    ELSE "status"::text
  END::"TaskStatus_new"
);
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "TaskStatus_old";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'Todo';
COMMIT;
