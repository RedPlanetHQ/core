-- Turn the stub Agents table into a per-workspace primitive.
-- Existing rows (if any) have no workspaceId and no meaningful semantics;
-- codebase grep confirmed zero writers to prisma.agents. Safe to drop.

-- Enum
DO $$ BEGIN
  CREATE TYPE "AgentStatus" AS ENUM ('Active', 'Archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Drop the old global unique on name (if it exists)
DROP INDEX IF EXISTS "Agents_name_key";

-- New columns
ALTER TABLE "Agents"
  ADD COLUMN IF NOT EXISTS "workspaceId"  TEXT,
  ADD COLUMN IF NOT EXISTS "handle"       TEXT,
  ADD COLUMN IF NOT EXISTS "displayName"  TEXT,
  ADD COLUMN IF NOT EXISTS "basePrompt"   TEXT,
  ADD COLUMN IF NOT EXISTS "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "model"        TEXT,
  ADD COLUMN IF NOT EXISTS "status"       "AgentStatus" NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS "gatewayId"    TEXT,
  ADD COLUMN IF NOT EXISTS "metadata"     JSONB DEFAULT '{}'::jsonb;

-- Drop pre-existing orphan rows (grep confirmed zero writers touched this table)
DELETE FROM "Agents" WHERE "workspaceId" IS NULL;

-- Drop the legacy `name` column (superseded by handle + displayName)
ALTER TABLE "Agents" DROP COLUMN IF EXISTS "name";

ALTER TABLE "Agents"
  ALTER COLUMN "workspaceId" SET NOT NULL,
  ALTER COLUMN "handle"      SET NOT NULL,
  ALTER COLUMN "displayName" SET NOT NULL,
  ALTER COLUMN "basePrompt"  SET NOT NULL;

-- FKs (idempotent)
DO $$ BEGIN
  ALTER TABLE "Agents"
    ADD CONSTRAINT "Agents_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Agents"
    ADD CONSTRAINT "Agents_gatewayId_fkey"
      FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "Agents_workspaceId_handle_key"
  ON "Agents"("workspaceId", "handle");

CREATE UNIQUE INDEX IF NOT EXISTS "Agents_gatewayId_key"
  ON "Agents"("gatewayId");

CREATE INDEX IF NOT EXISTS "Agents_workspaceId_status_idx"
  ON "Agents"("workspaceId", "status");
