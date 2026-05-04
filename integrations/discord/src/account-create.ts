import axios from 'axios';

interface DiscordBotUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string | null;
  bot?: boolean;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
}

export async function integrationCreate(data: Record<string, string>) {
  const { bot_token } = data;

  if (!bot_token || typeof bot_token !== 'string' || bot_token.trim().length === 0) {
    throw new Error('bot_token is required');
  }

  const token = bot_token.trim();

  const client = axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
  });

  let bot: DiscordBotUser;
  try {
    const response = await client.get<DiscordBotUser>('/users/@me');
    bot = response.data;
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401) {
      throw new Error('Invalid bot token. Verify the token in Discord Developer Portal → Bot → Reset Token.');
    }
    throw new Error(`Failed to validate bot token: ${error?.message || 'unknown error'}`);
  }

  if (!bot?.id) {
    throw new Error('Discord did not return a bot user. Token may be malformed.');
  }

  let guilds: DiscordGuild[] = [];
  try {
    const guildsResponse = await client.get<DiscordGuild[]>('/users/@me/guilds');
    guilds = guildsResponse.data ?? [];
  } catch (error) {
    // Non-fatal — bot may simply not be in any guild yet.
    guilds = [];
  }

  return [
    {
      type: 'account',
      data: {
        settings: {
          bot_username: bot.username,
          bot_id: bot.id,
        },
        accountId: bot.id,
        config: {
          bot_token: token,
          bot_id: bot.id,
          bot_username: bot.username,
          bot_avatar: bot.avatar ?? null,
          guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null })),
        },
      },
    },
  ];
}
