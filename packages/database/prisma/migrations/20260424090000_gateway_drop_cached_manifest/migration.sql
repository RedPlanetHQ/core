-- Drop cached manifest columns. Gateway agent + settings UI now live-fetch
-- the manifest via GET /manifest on each call, so the cache is redundant.
ALTER TABLE "Gateway"
  DROP COLUMN IF EXISTS "tools",
  DROP COLUMN IF EXISTS "manifest",
  DROP COLUMN IF EXISTS "manifestEtag";
