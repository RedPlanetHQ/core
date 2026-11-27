# Figma Integration for CORE

Connect your Figma workspace to CORE to track file updates, comments, version history, and design activity.

## Features

- OAuth2 Authorization Code flow (no API key required)
- Webhook-driven activity feed for real-time events
- MCP tool support for querying Figma data programmatically
- Scheduled sync to keep credentials validated

## OAuth2 Scopes

| Scope | Purpose |
|---|---|
| `file_content:read` | Read file document structure and metadata |
| `file_comments:read` | Read comments on files |
| `file_comments:write` | Post comments on files |
| `file_dev_resources:read` | Read dev resources attached to files |
| `webhooks:write` | Register and manage webhooks |

## MCP Tools

| Tool | Description |
|---|---|
| `figma_get_team_projects` | List all projects in a Figma team |
| `figma_get_project_files` | List all files in a project |
| `figma_get_file` | Fetch full document tree for a file |
| `figma_get_file_comments` | List all comments on a file |
| `figma_get_file_versions` | List version history of a file |
| `figma_create_webhook` | Register a webhook for real-time events |

## Setup

### Environment variables

```bash
FIGMA_CLIENT_ID=<your Figma OAuth2 client ID>
FIGMA_CLIENT_SECRET=<your Figma OAuth2 client secret>
DATABASE_URL=<PostgreSQL connection string>
```

### Register the integration

```bash
bun run scripts/register.ts
```

### Build

```bash
bun run build
```

## Webhook Events

The integration handles the following Figma webhook event types via `PROCESS`:

- `FILE_UPDATE` - A file was edited
- `FILE_VERSION_UPDATE` - A named version was saved
- `FILE_COMMENT` - A comment was posted
- `FILE_DELETE` - A file was deleted
- `LIBRARY_PUBLISH` - A library was published

> **TODO**: Register the webhook endpoint URL in `scripts/register.ts` once the CORE webhook receiver URL is known.
