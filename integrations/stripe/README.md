# Stripe Integration for CORE

Connects your Stripe account to CORE, syncing payments, subscriptions, customers, invoices, disputes, and payouts as activities.

## Auth

OAuth2 via Stripe Connect. Requires a Stripe platform account with Connect enabled.

Set the following env vars in the CORE server:
- `STRIPE_CLIENT_ID` — your Stripe platform's client ID
- `STRIPE_CLIENT_SECRET` — your Stripe platform's secret key

## Sync

Polls `/v1/events` every 6 hours using cursor-based pagination (`starting_after`). Converts Stripe events to CORE activities.

Events tracked:
- Charges (succeeded, failed, refunded, disputes)
- Payment intents (succeeded, failed, created, canceled)
- Subscriptions (created, updated, deleted, trial ending)
- Customers (created, updated, deleted)
- Invoices (paid, payment failed, created, finalized)
- Payouts (created, paid, failed)
- Disputes (created, closed)
- Refunds (created)

## Build

```bash
pnpm install
pnpm build
```

## Register

```bash
DATABASE_URL=<your-db-url> npx ts-node scripts/register.ts
```
