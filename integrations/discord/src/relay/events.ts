import type { Message, GuildMember, User } from 'discord.js';

export type RelayEventType = 'message_create' | 'guild_member_add';

export interface RelayEvent {
  event_type: RelayEventType;
  event_id: string;
  guild_id: string | null;
  channel_id: string | null;
  received_at: string;
  payload: unknown;
}

export function serializeMessageCreate(message: Message, botUser: User | null): RelayEvent {
  // Use discord.js's `mentions.has` to cover user mentions, role mentions of
  // any role the bot holds, and @everyone in one shot — replying to the bot
  // shouldn't count as a mention.
  const mentionsBot = botUser
    ? message.mentions.has(botUser, { ignoreRepliedUser: true })
    : false;

  // DMChannel has no name; fall back to the recipient's username so the
  // activity feed renders something readable instead of a bare snowflake.
  const channelName =
    'name' in message.channel && typeof message.channel.name === 'string'
      ? message.channel.name
      : message.channel.isDMBased()
      ? `DM with ${message.author.username}`
      : null;

  return {
    event_type: 'message_create',
    event_id: message.id,
    guild_id: message.guildId ?? null,
    channel_id: message.channelId,
    received_at: new Date().toISOString(),
    payload: {
      id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        bot: message.author.bot,
      },
      channel_id: message.channelId,
      channel_name: channelName,
      guild_id: message.guildId,
      guild_name: message.guild?.name ?? null,
      thread_id: message.channel.isThread() ? message.channelId : null,
      reference: message.reference
        ? {
            message_id: message.reference.messageId ?? null,
            channel_id: message.reference.channelId,
            guild_id: message.reference.guildId,
          }
        : null,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        name: a.name,
        content_type: a.contentType,
        size: a.size,
      })),
      mentions: {
        users: message.mentions.users.map((u) => u.id),
        roles: message.mentions.roles.map((r) => r.id),
        everyone: message.mentions.everyone,
      },
      mentions_bot: mentionsBot,
      created_at: message.createdAt.toISOString(),
      edited_at: message.editedAt?.toISOString() ?? null,
    },
  };
}

export function serializeGuildMemberAdd(member: GuildMember): RelayEvent {
  // Member joins don't have a unique Discord event ID, so we synthesize one
  // that's stable per (guild, user, joined_at) tuple.
  const joinedTs = member.joinedTimestamp ?? Date.now();
  const eventId = `member_add:${member.guild.id}:${member.id}:${joinedTs}`;

  return {
    event_type: 'guild_member_add',
    event_id: eventId,
    guild_id: member.guild.id,
    channel_id: null,
    received_at: new Date().toISOString(),
    payload: {
      user: {
        id: member.id,
        username: member.user.username,
        bot: member.user.bot,
        avatar: member.user.avatar,
      },
      guild_id: member.guild.id,
      guild_name: member.guild.name,
      joined_at: member.joinedAt?.toISOString() ?? null,
      nickname: member.nickname,
    },
  };
}
