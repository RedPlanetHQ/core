-- Per-agent personality (voice). Historically the workspace-wide voice
-- lived on User.metadata.personality; moving it onto Agents lets each
-- teammate (generalist, Cass, Alfred, etc.) sound different in the same
-- workspace. Default "tars" matches the prior workspace default so
-- existing rows keep behaving the same until an operator changes them.

ALTER TABLE "Agents"
  ADD COLUMN IF NOT EXISTS "personality" TEXT NOT NULL DEFAULT 'tars';
