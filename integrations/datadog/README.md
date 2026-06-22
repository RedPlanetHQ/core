# Datadog Integration for CORE

Connects your Datadog account to CORE, syncing monitor alerts and infrastructure events as activities.

## Auth

API Key + Application Key. Both are required.

You will need:
- **DD-API-KEY** — found in Datadog → Organization Settings → API Keys
- **DD-APPLICATION-KEY** — found in Datadog → Organization Settings → Application Keys
- **Region** — one of `US1` (default), `US3`, `US5`, `EU`, `AP1`

Region → base URL mapping:

| Region | Base URL |
|--------|----------|
| US1 | `https://api.datadoghq.com` |
| US3 | `https://us3.datadoghq.com` |
| US5 | `https://us5.datadoghq.com` |
| EU | `https://api.datadoghq.eu` |
| AP1 | `https://ap1.datadoghq.com` |

## Sync

Polls every 15 minutes using incremental timestamp-based sync.

- **Monitors**: fetches all monitors; surfaces those in ALERT or WARN state as activities.
- **Events**: fetches events since the last sync timestamp using cursor-based pagination (100 events per page).

Activities tracked:
- Monitor state changes (ALERT, WARN, NO DATA)
- Infrastructure events (deployments, restarts, custom events)

## Build

```bash
pnpm install
pnpm build
```

## Register

```bash
DATABASE_URL=<your-db-url> npx ts-node scripts/register.ts
```
