# Intercom Integration for CORE

Connects your Intercom workspace to CORE, syncing conversations, contacts, and events as activities.

## Features

- **Conversations**: Syncs new and updated support conversations with contact info, state, assignee, and message preview.
- **Contacts**: Tracks newly created or updated contacts (users and leads).
- **Events**: Captures custom events triggered by contacts.

## Authentication

Uses **OAuth2**. Users authorize via Intercom's OAuth flow:

- Authorization URL: `https://app.intercom.com/oauth`
- Token URL: `https://api.intercom.io/auth/eagle/token`
- Scopes: `read_users read_conversations`

## Setup

### Prerequisites

- An Intercom account with admin access.
- An OAuth app registered in the [Intercom Developer Hub](https://developers.intercom.com/).

### Build

```bash
cd integrations/intercom
pnpm install
pnpm build
```

### Register to Database

```bash
DATABASE_URL=<your-database-url> npx ts-node scripts/register.ts
```

## Sync Schedule

Runs every 15 minutes (`*/15 * * * *`).

## API Reference

- [Intercom REST API](https://developers.intercom.com/docs/references/rest-api/overview/)
- [OAuth Setup](https://developers.intercom.com/docs/build-an-integration/getting-started/)
