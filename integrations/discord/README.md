# @core/discord

Discord integration for Core. Authenticates with a bot token (no OAuth flow). Includes a Gateway WebSocket relay you can self-host to forward Discord events into Core.

> **Breaking change:** Earlier versions of this integration used Discord OAuth2. Existing connected accounts created via OAuth must be disconnected and re-connected with a bot token after upgrading.

## Setup

1. Create a Discord application at https://discord.com/developers/applications.
2. In **Bot** → **Reset Token**, copy the bot token.
3. On the same screen, enable:
   - **Message Content Intent** (required to read message bodies)
   - **Server Members Intent** (required to receive `GUILD_MEMBER_ADD` events)
4. In **OAuth2** → **URL Generator**, select scope `bot` and the permissions your bot needs (Send Messages, Read Message History, View Channel, Create Public Threads, Send Messages in Threads, Manage Webhooks if using personas). Open the generated URL and add the bot to your server.
5. In Core → Integrations → Discord, paste the bot token and connect.

## Relay

The relay holds the long-lived Discord Gateway WebSocket and forwards events to Core's webhook endpoint. See `src/relay/` and the run instructions below.

## Running the relay

The relay opens a long-lived Discord Gateway WebSocket using your bot token and forwards events to Core's webhook endpoint over HTTPS. Run it anywhere that supports a long-lived process: a VPS, Fly.io machine, Railway worker, Docker host, etc.

### Required environment variables

| Variable | Description |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord Developer Portal. |
| `CORE_WEBHOOK_URL` | Full URL of Core's Discord webhook endpoint, e.g. `https://core.example.com/webhook/discord`. |
| `CORE_WORKSPACE_TOKEN` | Workspace bearer token issued by Core when the integration was connected. |

### Optional environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `CORE_RELAY_ID` | _(none)_ | Identifier sent in `X-Core-Relay-Id` header so multiple relays per workspace can be distinguished. |

### Running with Docker

```bash
docker run -d --restart=always \
  -e DISCORD_BOT_TOKEN=... \
  -e CORE_WEBHOOK_URL=https://core.example.com/webhook/discord \
  -e CORE_WORKSPACE_TOKEN=... \
  core-discord-relay:latest
```

### Running with Node

```bash
pnpm install
pnpm build:relay
DISCORD_BOT_TOKEN=... \
CORE_WEBHOOK_URL=... \
CORE_WORKSPACE_TOKEN=... \
node dist/relay/index.js
```

### Required Discord intents

In the Developer Portal under **Bot**, enable:
- **Message Content Intent** — without this, the relay receives `message_create` events with empty content.
- **Server Members Intent** — without this, no `guild_member_add` events are delivered.

### Forwarded events

| Event type | Trigger | Notes |
| --- | --- | --- |
| `message_create` | New message in any channel the bot can see | Bot's own messages are filtered out to prevent loops. |
| `guild_member_add` | A new member joins a guild the bot is in | `event_id` is synthesized from `(guild_id, user_id, joined_at)` for idempotency. |

### Webhook contract

The relay POSTs to `CORE_WEBHOOK_URL` with:

- Headers:
  - `Authorization: Bearer <CORE_WORKSPACE_TOKEN>`
  - `X-Idempotency-Key: <event_id>`
  - `X-Core-Relay-Id: <CORE_RELAY_ID>` (if set)
- JSON body shaped like:
  ```json
  {
    "event_type": "message_create" | "guild_member_add",
    "event_id": "string",
    "guild_id": "string | null",
    "channel_id": "string | null",
    "received_at": "ISO-8601 timestamp",
    "payload": { ... event-specific fields ... }
  }
  ```

The relay retries 5xx and network failures with exponential backoff (5 attempts, starting at 500 ms). It does not retry 4xx — fix the configuration and restart.
