# Ghost Blog Integration

Connect your Ghost blog to CORE. Manage posts, pages, tags, and members directly from your workspace using natural language.

## Authentication

Ghost uses **Admin API Key** authentication (JWT-based). You will need:

1. **Ghost Blog URL** — your Ghost instance URL, e.g. `https://myblog.ghost.io`
2. **Admin API Key** — found in Ghost Admin → Settings → Integrations → Add custom integration → **Admin API Key** (format: `key-id:hex-secret`)

> The integration generates a short-lived JWT token from the Admin API Key automatically on each request.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `ghost_list_posts` | List posts with optional status filter and pagination |
| `ghost_get_post` | Get a single post by ID |
| `ghost_create_post` | Create a new post (title, HTML, tags, status) |
| `ghost_update_post` | Update an existing post by ID |
| `ghost_delete_post` | Delete a post by ID |
| `ghost_list_pages` | List static pages |
| `ghost_create_page` | Create a new static page |
| `ghost_update_page` | Update an existing static page by ID |
| `ghost_list_tags` | List all tags |
| `ghost_create_tag` | Create a new tag |
| `ghost_list_members` | List members/subscribers |
| `ghost_get_site` | Get site settings and info |

## Building

```bash
cd integrations/ghost
pnpm install
bun run build
```

## Testing

```bash
# Check spec
node bin/index.js spec

# List tools
node bin/index.js get-tools \
  --config '{"ghost_url":"https://myblog.ghost.io","admin_api_key":"id:secret"}' \
  --integration-definition '{}'

# Get site info
node bin/index.js call-tool \
  --config '{"ghost_url":"https://myblog.ghost.io","admin_api_key":"id:secret"}' \
  --tool-name ghost_get_site \
  --tool-arguments '{}' \
  --integration-definition '{}'
```
