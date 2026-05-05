interface ActivityMessage {
  type: 'activity';
  data: {
    text: string;
    sourceURL: string;
  };
}

interface MessageCreatePayload {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  channel_id: string;
  channel_name: string | null;
  guild_id: string | null;
  guild_name: string | null;
  thread_id: string | null;
  reference: { message_id: string | null; channel_id: string; guild_id: string | null } | null;
  attachments: Array<{
    id: string;
    url: string;
    name: string;
    content_type: string | null;
    size: number;
  }>;
  mentions: { users: string[]; roles: string[]; everyone: boolean };
  // Set by the relay when the message mentions the bot user, any role the
  // bot holds, or @everyone. Optional for back-compat with older relay payloads.
  mentions_bot?: boolean;
  created_at: string;
  edited_at: string | null;
}

interface GuildMemberAddPayload {
  user: { id: string; username: string; bot?: boolean; avatar: string | null };
  guild_id: string;
  guild_name: string;
  joined_at: string | null;
  nickname: string | null;
}

interface RelayEvent {
  event_type: 'message_create' | 'guild_member_add';
  event_id: string;
  guild_id: string | null;
  channel_id: string | null;
  received_at: string;
  payload: MessageCreatePayload | GuildMemberAddPayload;
}

function activity(text: string, sourceURL: string): ActivityMessage {
  return { type: 'activity', data: { text, sourceURL } };
}

function messageURL(guildId: string | null, channelId: string, messageId: string): string {
  const scope = guildId ?? '@me';
  return `https://discord.com/channels/${scope}/${channelId}/${messageId}`;
}

function guildURL(guildId: string): string {
  return `https://discord.com/channels/${guildId}`;
}

function handleMessageCreate(event: RelayEvent, config: any): ActivityMessage[] {
  const payload = event.payload as MessageCreatePayload;

  if (payload.author.bot) return [];

  const botId = config?.bot_id as string | undefined;
  const isDM = !payload.guild_id;
  // Prefer the relay-computed flag (covers user mentions, role mentions of
  // bot-held roles, and @everyone). Fall back to a user-id check for older
  // relay payloads that don't ship `mentions_bot`.
  const mentionsBot =
    payload.mentions_bot ?? (botId ? payload.mentions.users.includes(botId) : false);

  // Only surface messages directed at the bot — DMs or @mentions.
  // Public channel chatter would otherwise flood the activity feed.
  // if (!isDM && !mentionsBot) return [];

  const snippet = payload.content?.trim().length
    ? payload.content.length > 200
      ? `${payload.content.slice(0, 200)}…`
      : payload.content
    : payload.attachments.length
      ? `[${payload.attachments.length} attachment(s)]`
      : '[no text]';

  const replyPart = payload.reference?.message_id
    ? ` (reply to message ${payload.reference.message_id})`
    : '';

  const channelLabel = payload.channel_name
    ? `#${payload.channel_name} (channel_id: ${payload.channel_id})`
    : `channel ${payload.channel_id}`;
  const guildLabel = payload.guild_name
    ? `${payload.guild_name} (guild_id: ${payload.guild_id})`
    : `guild ${payload.guild_id}`;

  const text = isDM
    ? `Received a direct message from ${payload.author.username} (user_id: ${payload.author.id}) in ${channelLabel} (message_id: ${payload.id})${replyPart} at ${payload.created_at}. Content: "${snippet}"`
    : `Received a mention from ${payload.author.username} (user_id: ${payload.author.id}) in ${channelLabel} of ${guildLabel} (message_id: ${payload.id})${replyPart} at ${payload.created_at}. Content: "${snippet}"`;

  return [activity(text, messageURL(payload.guild_id, payload.channel_id, payload.id))];
}

function handleGuildMemberAdd(event: RelayEvent): ActivityMessage[] {
  const payload = event.payload as GuildMemberAddPayload;
  if (payload.user.bot) return [];

  const nicknamePart = payload.nickname ? ` (nickname: ${payload.nickname})` : '';
  const joinedAt = payload.joined_at ?? event.received_at;
  const text = `${payload.user.username} (user_id: ${payload.user.id})${nicknamePart} joined guild ${payload.guild_name} (guild_id: ${payload.guild_id}) at ${joinedAt}`;

  return [activity(text, guildURL(payload.guild_id))];
}

export const createActivityEvent = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData: any,
  config: any
): Promise<ActivityMessage[]> => {
  if (!eventData || typeof eventData !== 'object') return [];

  const event = eventData as RelayEvent;

  switch (event.event_type) {
    case 'message_create':
      return handleMessageCreate(event, config);
    case 'guild_member_add':
      return handleGuildMemberAdd(event);
    default:
      return [];
  }
};
