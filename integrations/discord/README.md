# @core/discord

Discord integration for Core. Authenticates with a bot token (no OAuth flow). Includes a Gateway WebSocket relay you can self-host to forward Discord events into Core.

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
