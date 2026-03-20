# Sentry Integration for CORE

Connect your Sentry organization to CORE to track errors, manage issues, monitor releases, and stay on top of application health.

## Setup

1. Go to **Sentry → Settings → Auth Tokens** and create a new token with at minimum:
   - `org:read`
   - `project:read`
   - `issue:read`
   - `issue:write` (optional, for resolving/assigning issues)
2. Connect the integration in CORE with your auth token and Sentry host URL.

## Features

- **Activity sync** (every 30 min): New issues are surfaced as activities in your workspace.
- **MCP Tools**: Query issues, projects, releases, teams, and members directly from CORE.

## Available Tools

| Tool | Description |
|------|-------------|
| `sentry_list_issues` | List issues with optional query/project filter |
| `sentry_get_issue` | Get a specific issue by ID |
| `sentry_update_issue` | Resolve, ignore, or reassign an issue |
| `sentry_list_events` | List individual error events for an issue |
| `sentry_list_projects` | List all projects in the org |
| `sentry_get_project` | Get a specific project by slug |
| `sentry_list_releases` | List releases, optionally filtered by project |
| `sentry_get_release` | Get a specific release by version |
| `sentry_list_teams` | List all teams in the org |
| `sentry_get_organization` | Get organization details |
| `sentry_list_members` | List organization members |

## Environment Variables (for local development)

```
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxxxxxx
SENTRY_HOST=https://sentry.io
SENTRY_ORG_SLUG=my-org
```
