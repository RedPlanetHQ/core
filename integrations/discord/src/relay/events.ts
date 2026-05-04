import type { Message, GuildMember } from 'discord.js';

export type RelayEventType = 'message_create' | 'guild_member_add';

export interface RelayEvent {
  event_type: RelayEventType;
  event_id: string;
  guild_id: string | null;
  channel_id: string | null;
  received_at: string;
  payload: unknown;
}

export function serializeMessageCreate(message: Message): RelayEvent {
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
      guild_id: message.guildId,
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
