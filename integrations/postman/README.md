# Postman Integration

Automatic Postman activity tracking and API surface integration for CORE memory system.

## Overview

The Postman integration captures activity across your Postman workspaces, collections, environments, APIs, monitors, and mock servers, processes them into structured events, and ingests them into CORE's knowledge graph. It also exposes Postman as a set of read-only MCP tools so the agent can inspect your API platform on demand.

## Features

### 📊 Activity Tracking

- **Workspaces**: Created and updated workspaces
- **Collections**: Created and updated collections, including forks
- **Environments**: Created and updated environments
- **APIs**: New API definitions and updates
- **Monitor Runs**: New monitor runs, with assertion pass/fail summary

### 🔔 Notification Processing

- **Monitor Outcomes**: Surfaces failing assertions as activity events
- **Fork Awareness**: Marks forked collections so context is preserved

### 🔗 MCP Integration

- Read-only MCP tools for user, workspaces, collections, environments, APIs (and versions), monitors, and mocks
- Backed by the Postman REST API (`https://api.getpostman.com`)

## Authentication

Uses **API Key** authentication:

- Requires a Postman API key (`PMAK-...`)
- Generated in Postman → Settings → API Keys → Generate API Key
- Sent as `X-Api-Key` on every request

## Configuration

### Schedule

- **Frequency**: Every 15 minutes (`*/15 * * * *`)
- **Sync Window**: 24 hours on first run, then incremental from `lastSyncTime`
- **Rate Limiting**: Respects the Postman free-tier limit (300 req/min); 429 responses surface a clear back-off error

### Data Processing

- **Incremental Sync**: Tracks `lastSyncTime` plus per-resource cursors
- **Deduplication**: Monitor runs are deduped by `seenMonitorRunIds[monitorUid]`
- **Caps**: 50–100 items per resource per tick to stay polite under rate limits

## Event Types

### Workspace Activities

```
Workspace "{name}" was created (visibility: {visibility}, type: {type})
Workspace "{name}" was updated (visibility: {visibility}, type: {type})
```

### Collection Activities

```
Collection "{name}" was created by {owner}
Collection "{name}" was updated by {owner}
Collection "{name}" was created by {owner} (fork: {label})
```

### Environment Activities

```
Environment "{name}" was created
Environment "{name}" was updated
```

### API Activities

```
API "{name}" was created: {summary}
API "{name}" was updated: {summary}
```

### Monitor Run Activities

```
Monitor "{name}" ran — all {n} assertions passed at {timestamp}
Monitor "{name}" ran — {failed}/{total} assertions failed at {timestamp}
```

## MCP Tools

| Tool                | Postman endpoint             |
| ------------------- | ---------------------------- |
| `get_me`            | `GET /me`                    |
| `list_workspaces`   | `GET /workspaces`            |
| `get_workspace`     | `GET /workspaces/{id}`       |
| `list_collections`  | `GET /collections`           |
| `get_collection`    | `GET /collections/{uid}`     |
| `list_environments` | `GET /environments`          |
| `get_environment`   | `GET /environments/{uid}`    |
| `list_apis`         | `GET /apis`                  |
| `get_api`           | `GET /apis/{apiId}`          |
| `list_api_versions` | `GET /apis/{apiId}/versions` |
| `list_monitors`     | `GET /monitors`              |
| `get_monitor`       | `GET /monitors/{uid}`        |
| `list_mocks`        | `GET /mocks`                 |
| `get_mock`          | `GET /mocks/{uid}`           |

## Setup

The `integrations/` directory is **not** part of the pnpm workspace, so run commands from inside this folder directly:

```bash
cd integrations/postman

# Install dependencies (first time only)
npm install

# Build the integration bundle → bin/index.js
npm run build

# Register it in the local Postgres
# (reads DATABASE_URL from integrations/postman/.env if present)
npm run register
```

Then connect from the webapp: **Settings → MCP Integrations → Postman → Connect** and paste your `PMAK-...` key.

## File Structure

```
postman/
├── src/
│   ├── index.ts              # Entry point + spec
│   ├── account-create.ts     # API key validation
│   ├── schedule.ts           # Sync logic
│   ├── create-activity.ts    # Activity formatters
│   ├── utils.ts              # Postman API helpers
│   └── mcp/                  # MCP tool definitions
├── scripts/
│   └── register.ts           # IntegrationDefinitionV2 upsert
├── package.json
└── README.md
```
