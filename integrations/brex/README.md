# Brex Integration for CORE

Read-only Brex integration: syncs settled card transactions and statements, exposes MCP tools for drilldown and spend aggregation.

## Auth

Customer token (Brex PAT). Sent as `Authorization: Bearer <token>` to `https://platform.brexapis.com`.

Generate in **Brex Dashboard → Developer → Create Token**. Grant at minimum:

- `accounts.readonly`
- `transactions.readonly`

The token is stored encrypted in `IntegrationAccount.integrationConfiguration` via the generic `api_key` auth flow.

## Sync

Polling every 4 hours (`0 */4 * * *`). On each tick:

- `GET /v2/transactions/card/primary` with `posted_at_start` = last sync date, paginated via `cursor`
- `GET /v2/accounts/card/primary/statements` (latest 10)

Emits one CORE activity per new transaction and per new statement. Advances `lastSyncTime`; dedupes via `seenTransactionIds` (capped at 500) and `seenStatementIds` (capped at 50) in state.

### Caveats

- **Settled only.** Brex's transaction endpoint returns settled transactions. Pending charges do not appear until posted. Near statement cutoff, the statement total may briefly exceed the visible transaction sum.
- **No sandbox.** `api-staging.brex.com` is not a stable sandbox and does not work with customer tokens. Test against production with a scoped token.
- **v1 scope: card only.** Cash accounts, expenses (`/v1/expenses`), and Team API (issued-card metadata) are out of scope for v1.

## MCP tools

- `list_card_accounts` — list Brex card accounts with balances and status.
- `list_transactions` — paginate settled transactions for the primary card account.
- `list_statements` — list recent statements.
- `get_statement` — fetch a single statement by ID.
- `get_top_merchants` — aggregate primary card account spend by merchant for a given window.

## Build

```bash
pnpm install
pnpm build
```

Output: `dist/index.js` (bundled, minified).

## Test

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

Covers: `formatMoney`, activity text builders, dashboard URL formatting, Brex client creation, `handleSchedule` state advancement + dedupe + error tolerance + pagination cap, and all MCP tool handlers with mocked axios.

## Register

```bash
DATABASE_URL=<your-core-db-url> pnpm register
```

Inserts or upserts the `IntegrationDefinitionV2` row pointing at `../../integrations/brex/dist/index.js` (picked up by `IntegrationRunner` on next load).

## UI

No custom frontend. The generic `api-key-auth-section.tsx` component renders the token paste screen from `Spec.auth.api_key.fields`. Activities flow into CORE's knowledge graph; tools are available to the agent for on-demand lookup.
