-- Ghost Blog Integration Registration
-- Run against your database when Postgres is available.
-- Replace <ABSOLUTE_PATH_TO_BIN> with the actual path to bin/index.cjs,
-- e.g. /home/user/core/integrations/ghost/bin/index.cjs
-- In production, use a hosted URL instead of a local path.
--
-- Usage:
--   psql "$DATABASE_URL" -f integrations/ghost/scripts/register.sql
--
-- Or from psql prompt:
--   \i integrations/ghost/scripts/register.sql

INSERT INTO "IntegrationDefinitionV2" (
  id,
  "createdAt",
  "updatedAt",
  name,
  slug,
  description,
  icon,
  version,
  url,
  spec
)
VALUES (
  gen_random_uuid(),
  NOW(),
  NOW(),
  'Ghost Blog',
  'ghost',
  'Connect your Ghost blog to manage posts, pages, tags, and members. Create and publish content directly from your workspace.',
  'ghost',
  '0.1.0',
  '<ABSOLUTE_PATH_TO_BIN>',
  '{
    "name": "Ghost Blog",
    "key": "ghost",
    "description": "Connect your Ghost blog to manage posts, pages, tags, and members.",
    "icon": "ghost",
    "mcp": {"type": "cli"},
    "auth": {
      "api_key": {
        "fields": [
          {
            "name": "ghost_url",
            "label": "Ghost Blog URL",
            "placeholder": "https://myblog.ghost.io",
            "description": "Your Ghost blog URL without a trailing slash."
          },
          {
            "name": "admin_api_key",
            "label": "Admin API Key",
            "placeholder": "your-key-id:your-secret",
            "description": "Found in Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key."
          }
        ]
      }
    }
  }'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  slug        = EXCLUDED.slug,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  version     = EXCLUDED.version,
  url         = EXCLUDED.url,
  spec        = EXCLUDED.spec,
  "updatedAt" = NOW();
