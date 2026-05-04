import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Create a Discord REST client authenticated with a bot token.
 */
function createDiscordClient(botToken: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
  });
}

const CHANNEL_TYPES: Record<number, string> = {
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  10: 'announcement_thread',
  11: 'public_thread',
  12: 'private_thread',
  13: 'stage',
  15: 'forum',
  16: 'media',
};

// Schema definitions for Messages
const SendMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID to send the message to'),
  content: z.string().describe('Message content (up to 2000 characters)'),
  reply_to_message_id: z.string().optional().describe('Message ID to reply to'),
  tts: z.boolean().optional().describe('Text-to-speech enabled'),
  embeds: z
    .array(
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
        color: z.number().optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              inline: z.boolean().optional(),
            })
          )
          .optional(),
      })
    )
    .optional()
    .describe('Rich embeds for the message'),
});

const GetMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID to retrieve'),
});

const GetChannelMessagesSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  limit: z.number().optional().default(50).describe('Number of messages to retrieve (1-100)'),
  before: z.string().optional().describe('Get messages before this message ID'),
  after: z.string().optional().describe('Get messages after this message ID'),
});

const DeleteMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID to delete'),
});

const AddReactionSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID'),
  emoji: z.string().describe('Emoji to add (unicode emoji or custom emoji format: name:id)'),
});

// Schema definitions for Channels
const CreateChannelSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  name: z.string().describe('Channel name'),
  type: z
    .number()
    .optional()
    .default(0)
    .describe('Channel type (0=text, 2=voice, 4=category, 5=announcement)'),
  topic: z.string().optional().describe('Channel topic (text channels only)'),
  parent_id: z.string().optional().describe('Parent category ID'),
});

const GetChannelSchema = z.object({
  channel_id: z.string().describe('Channel ID to retrieve'),
});

const UpdateChannelSchema = z.object({
  channel_id: z.string().describe('Channel ID to update'),
  name: z.string().optional().describe('New channel name'),
  topic: z.string().optional().describe('New channel topic'),
  position: z.number().optional().describe('Sorting position'),
});

const DeleteChannelSchema = z.object({
  channel_id: z.string().describe('Channel ID to delete'),
});

const ListGuildChannelsSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
});

// Schema definitions for Guilds (Servers)
const GetGuildSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID to retrieve'),
});

const ListGuildsSchema = z.object({});

const GetGuildMembersSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  limit: z.number().optional().default(100).describe('Number of members to retrieve (1-1000)'),
});

const GetGuildMemberSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID'),
});

// Schema definitions for Roles
const CreateRoleSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  name: z.string().describe('Role name'),
  permissions: z.string().optional().describe('Bitwise permission integer as string'),
  color: z.number().optional().describe('RGB color value'),
  hoist: z.boolean().optional().describe('Display role separately'),
  mentionable: z.boolean().optional().describe('Allow anyone to mention this role'),
});

const UpdateRoleSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  role_id: z.string().describe('Role ID to update'),
  name: z.string().optional().describe('New role name'),
  permissions: z.string().optional().describe('Bitwise permission integer as string'),
  color: z.number().optional().describe('RGB color value'),
  hoist: z.boolean().optional().describe('Display role separately'),
  mentionable: z.boolean().optional().describe('Allow anyone to mention this role'),
});

const DeleteRoleSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  role_id: z.string().describe('Role ID to delete'),
});

const AddMemberRoleSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID'),
  role_id: z.string().describe('Role ID to add'),
});

const RemoveMemberRoleSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID'),
  role_id: z.string().describe('Role ID to remove'),
});

// Schema definitions for Message editing and pinning
const EditMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID to edit'),
  content: z.string().optional().describe('New message content'),
  embeds: z
    .array(
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
        color: z.number().optional(),
        fields: z
          .array(z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() }))
          .optional(),
      })
    )
    .optional()
    .describe('New embeds'),
});

const PinMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID to pin'),
});

const UnpinMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID to unpin'),
});

const GetPinnedMessagesSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
});

// Schema definitions for Threads
const CreateThreadSchema = z.object({
  channel_id: z.string().describe('Channel ID to create thread in'),
  name: z.string().describe('Thread name'),
  message_id: z.string().optional().describe('Message ID to start thread from (forum/text threads)'),
  auto_archive_duration: z
    .number()
    .optional()
    .describe('Auto archive duration in minutes (60, 1440, 4320, 10080)'),
  type: z.number().optional().describe('Thread type (10=announcement, 11=public, 12=private)'),
});

// Schema definitions for Reactions
const RemoveReactionSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID'),
  emoji: z.string().describe('Emoji to remove'),
  user_id: z.string().optional().describe('User ID whose reaction to remove (omit for own reaction)'),
});

const GetReactionsSchema = z.object({
  channel_id: z.string().describe('Channel ID'),
  message_id: z.string().describe('Message ID'),
  emoji: z.string().describe('Emoji to get reactions for'),
  limit: z.number().optional().default(25).describe('Number of users to return (max 100)'),
});

// Schema definitions for Member moderation
const KickMemberSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID to kick'),
});

const BanMemberSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID to ban'),
  delete_message_seconds: z
    .number()
    .optional()
    .describe('Number of seconds of messages to delete (max 604800)'),
  reason: z.string().optional().describe('Reason for the ban'),
});

const UnbanMemberSchema = z.object({
  guild_id: z.string().describe('Guild (server) ID'),
  user_id: z.string().describe('User ID to unban'),
});

// Schema definitions for Invites
const CreateInviteSchema = z.object({
  channel_id: z.string().describe('Channel ID to create invite for'),
  max_age: z
    .number()
    .optional()
    .describe('Duration in seconds before invite expires (0 = never, default 86400)'),
  max_uses: z.number().optional().describe('Max number of uses (0 = unlimited)'),
  temporary: z.boolean().optional().describe('Whether invite grants temporary membership'),
  unique: z.boolean().optional().describe('Whether to guarantee a unique invite'),
});

const DeleteInviteSchema = z.object({
  invite_code: z.string().describe('Invite code to delete'),
});

// Schema definitions for DMs
const CreateDMSchema = z.object({
  recipient_id: z.string().describe('User ID to open a DM with'),
});

// Schema definitions for Users
const GetCurrentUserSchema = z.object({});

const GetUserSchema = z.object({
  user_id: z.string().describe('User ID to retrieve'),
});

/**
 * Get list of available tools
 */
export async function getTools() {
  return [
    // Message tools
    {
      name: 'send_message',
      description: 'Sends a message to a Discord channel or DM channel. Use reply_to_message_id to reply to a specific message.',
      inputSchema: zodToJsonSchema(SendMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_message',
      description: 'Retrieves a specific message',
      inputSchema: zodToJsonSchema(GetMessageSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_channel_messages',
      description: 'Retrieves messages from a channel',
      inputSchema: zodToJsonSchema(GetChannelMessagesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_message',
      description: 'Deletes a message',
      inputSchema: zodToJsonSchema(DeleteMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'add_reaction',
      description: 'Adds a reaction to a message',
      inputSchema: zodToJsonSchema(AddReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Channel tools
    {
      name: 'create_channel',
      description: 'Creates a new channel in a guild',
      inputSchema: zodToJsonSchema(CreateChannelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_channel',
      description: 'Retrieves a channel by ID',
      inputSchema: zodToJsonSchema(GetChannelSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_channel',
      description: 'Updates a channel',
      inputSchema: zodToJsonSchema(UpdateChannelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_channel',
      description: 'Deletes a channel',
      inputSchema: zodToJsonSchema(DeleteChannelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'list_guild_channels',
      description: 'Lists all channels in a guild',
      inputSchema: zodToJsonSchema(ListGuildChannelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Guild tools
    {
      name: 'get_guild',
      description: 'Retrieves guild (server) information',
      inputSchema: zodToJsonSchema(GetGuildSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_guilds',
      description: 'Lists all guilds the bot is in',
      inputSchema: zodToJsonSchema(ListGuildsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_guild_members',
      description: 'Lists members in a guild',
      inputSchema: zodToJsonSchema(GetGuildMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_guild_member',
      description: 'Retrieves a specific guild member',
      inputSchema: zodToJsonSchema(GetGuildMemberSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Role tools
    {
      name: 'create_role',
      description: 'Creates a new role in a guild',
      inputSchema: zodToJsonSchema(CreateRoleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_role',
      description: 'Updates a role',
      inputSchema: zodToJsonSchema(UpdateRoleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_role',
      description: 'Deletes a role',
      inputSchema: zodToJsonSchema(DeleteRoleSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'add_member_role',
      description: 'Adds a role to a guild member',
      inputSchema: zodToJsonSchema(AddMemberRoleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'remove_member_role',
      description: 'Removes a role from a guild member',
      inputSchema: zodToJsonSchema(RemoveMemberRoleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Message editing and pinning tools
    {
      name: 'edit_message',
      description: 'Edits a previously sent message',
      inputSchema: zodToJsonSchema(EditMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'pin_message',
      description: 'Pins a message in a channel',
      inputSchema: zodToJsonSchema(PinMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'unpin_message',
      description: 'Unpins a message from a channel',
      inputSchema: zodToJsonSchema(UnpinMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_pinned_messages',
      description: 'Gets all pinned messages in a channel',
      inputSchema: zodToJsonSchema(GetPinnedMessagesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Thread tools
    {
      name: 'create_thread',
      description: 'Creates a new thread in a channel',
      inputSchema: zodToJsonSchema(CreateThreadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    // Reaction tools
    {
      name: 'remove_reaction',
      description: 'Removes a reaction from a message',
      inputSchema: zodToJsonSchema(RemoveReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_reactions',
      description: 'Gets a list of users who reacted with a specific emoji',
      inputSchema: zodToJsonSchema(GetReactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Moderation tools
    {
      name: 'kick_member',
      description: 'Kicks a member from a guild',
      inputSchema: zodToJsonSchema(KickMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'ban_member',
      description: 'Bans a member from a guild',
      inputSchema: zodToJsonSchema(BanMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'unban_member',
      description: 'Unbans a user from a guild',
      inputSchema: zodToJsonSchema(UnbanMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Invite tools
    {
      name: 'create_invite',
      description: 'Creates an invite for a channel',
      inputSchema: zodToJsonSchema(CreateInviteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'delete_invite',
      description: 'Deletes an invite by code',
      inputSchema: zodToJsonSchema(DeleteInviteSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // DM tools
    {
      name: 'create_dm',
      description: 'Opens a direct message channel with a user',
      inputSchema: zodToJsonSchema(CreateDMSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // User tools
    {
      name: 'get_current_user',
      description: 'Gets information about the current user',
      inputSchema: zodToJsonSchema(GetCurrentUserSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_user',
      description: 'Gets information about a user',
      inputSchema: zodToJsonSchema(GetUserSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/**
 * Call a specific tool
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  botToken: string
) {
  const discordClient = createDiscordClient(botToken);

  try {
    switch (name) {
      // Message operations
      case 'send_message': {
        const validatedArgs = SendMessageSchema.parse(args);
        const body: any = {
          content: validatedArgs.content,
          tts: validatedArgs.tts,
          embeds: validatedArgs.embeds,
        };
        if (validatedArgs.reply_to_message_id) {
          body.message_reference = { message_id: validatedArgs.reply_to_message_id };
        }
        const response = await discordClient.post(
          `/channels/${validatedArgs.channel_id}/messages`,
          body
        );

        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully:\nMessage ID: ${response.data.id}\nChannel ID: ${response.data.channel_id}${validatedArgs.reply_to_message_id ? `\nIn reply to: ${validatedArgs.reply_to_message_id}` : ''}`,
            },
          ],
        };
      }

      case 'get_message': {
        const validatedArgs = GetMessageSchema.parse(args);
        const response = await discordClient.get(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}`
        );

        const msg = response.data;
        const parts: string[] = [];
        if (msg.content) parts.push(msg.content);
        if (msg.embeds?.length) {
          for (const embed of msg.embeds) {
            const embedParts: string[] = [];
            if (embed.title) embedParts.push(`**${embed.title}**`);
            if (embed.description) embedParts.push(embed.description);
            if (embed.fields?.length) {
              for (const field of embed.fields) {
                embedParts.push(`${field.name}: ${field.value}`);
              }
            }
            if (embed.url) embedParts.push(`URL: ${embed.url}`);
            if (embedParts.length) parts.push(`[Embed] ${embedParts.join(' | ')}`);
          }
        }
        if (msg.attachments?.length) {
          for (const att of msg.attachments) {
            parts.push(`[Attachment] ${att.filename}: ${att.url}`);
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Message details:\nMessage ID: ${msg.id}\nChannel ID: ${msg.channel_id}\nAuthor: ${msg.author.username} (id: ${msg.author.id})\nTimestamp: ${msg.timestamp}\nContent: ${parts.join('\n') || '[no readable content]'}`,
            },
          ],
        };
      }

      case 'get_channel_messages': {
        const validatedArgs = GetChannelMessagesSchema.parse(args);
        const params: any = { limit: validatedArgs.limit };
        if (validatedArgs.before) params.before = validatedArgs.before;
        if (validatedArgs.after) params.after = validatedArgs.after;

        const response = await discordClient.get(
          `/channels/${validatedArgs.channel_id}/messages`,
          { params }
        );

        const messages = response.data
          .map((msg: any) => {
            if (msg.thread) {
              return `[${msg.timestamp}] (msg_id: ${msg.id}) ${msg.author.username} (user_id: ${msg.author.id}): [Thread] "${msg.thread.name}" (thread_id: ${msg.thread.id}, ${msg.thread.message_count} messages)`;
            }
            const parts: string[] = [];
            if (msg.content) parts.push(msg.content);
            if (msg.embeds?.length) {
              for (const embed of msg.embeds) {
                const embedParts: string[] = [];
                if (embed.title) embedParts.push(`**${embed.title}**`);
                if (embed.description) embedParts.push(embed.description);
                if (embed.fields?.length) {
                  for (const field of embed.fields) {
                    embedParts.push(`${field.name}: ${field.value}`);
                  }
                }
                if (embed.url) embedParts.push(`URL: ${embed.url}`);
                if (embedParts.length) parts.push(`[Embed] ${embedParts.join(' | ')}`);
              }
            }
            if (msg.attachments?.length) {
              for (const att of msg.attachments) {
                parts.push(`[Attachment] ${att.filename}: ${att.url}`);
              }
            }
            const body = parts.length ? parts.join('\n') : '[no readable content]';
            return `[${msg.timestamp}] (msg_id: ${msg.id}) ${msg.author.username} (user_id: ${msg.author.id}): ${body}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Retrieved ${response.data.length} messages:\n\n${messages}`,
            },
          ],
        };
      }

      case 'delete_message': {
        const validatedArgs = DeleteMessageSchema.parse(args);
        await discordClient.delete(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Message ${validatedArgs.message_id} deleted successfully`,
            },
          ],
        };
      }

      case 'add_reaction': {
        const validatedArgs = AddReactionSchema.parse(args);
        await discordClient.put(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}/reactions/${encodeURIComponent(validatedArgs.emoji)}/@me`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Reaction ${validatedArgs.emoji} added to message ${validatedArgs.message_id}`,
            },
          ],
        };
      }

      // Channel operations
      case 'create_channel': {
        const validatedArgs = CreateChannelSchema.parse(args);
        const response = await discordClient.post(`/guilds/${validatedArgs.guild_id}/channels`, {
          name: validatedArgs.name,
          type: validatedArgs.type,
          topic: validatedArgs.topic,
          parent_id: validatedArgs.parent_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Channel created successfully:\nID: ${response.data.id}\nName: ${response.data.name}`,
            },
          ],
        };
      }

      case 'get_channel': {
        const validatedArgs = GetChannelSchema.parse(args);
        const response = await discordClient.get(`/channels/${validatedArgs.channel_id}`);

        const ch = response.data;
        return {
          content: [
            {
              type: 'text',
              text: `Channel details:\nID: ${ch.id}\nName: ${ch.name}\nType: ${CHANNEL_TYPES[ch.type] || `unknown(${ch.type})`}\nGuild ID: ${ch.guild_id || 'N/A'}\nTopic: ${ch.topic || 'N/A'}${ch.parent_id ? `\nCategory ID: ${ch.parent_id}` : ''}`,
            },
          ],
        };
      }

      case 'update_channel': {
        const validatedArgs = UpdateChannelSchema.parse(args);
        const updateData: any = {};
        if (validatedArgs.name) updateData.name = validatedArgs.name;
        if (validatedArgs.topic !== undefined) updateData.topic = validatedArgs.topic;
        if (validatedArgs.position !== undefined) updateData.position = validatedArgs.position;

        const response = await discordClient.patch(
          `/channels/${validatedArgs.channel_id}`,
          updateData
        );

        return {
          content: [
            {
              type: 'text',
              text: `Channel ${response.data.id} updated successfully`,
            },
          ],
        };
      }

      case 'delete_channel': {
        const validatedArgs = DeleteChannelSchema.parse(args);
        await discordClient.delete(`/channels/${validatedArgs.channel_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Channel ${validatedArgs.channel_id} deleted successfully`,
            },
          ],
        };
      }

      case 'list_guild_channels': {
        const validatedArgs = ListGuildChannelsSchema.parse(args);
        const response = await discordClient.get(`/guilds/${validatedArgs.guild_id}/channels`);

        const channels = response.data
          .map((ch: any) => {
            const type = CHANNEL_TYPES[ch.type] || `unknown(${ch.type})`;
            const parent = ch.parent_id ? `, category_id: ${ch.parent_id}` : '';
            return `ID: ${ch.id}, Name: ${ch.name}, Type: ${type}${parent}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.length} channels:\n\n${channels}`,
            },
          ],
        };
      }

      // Guild operations
      case 'get_guild': {
        const validatedArgs = GetGuildSchema.parse(args);
        const response = await discordClient.get(`/guilds/${validatedArgs.guild_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Guild details:\nID: ${response.data.id}\nName: ${response.data.name}\nMember Count: ${response.data.approximate_member_count || 'N/A'}`,
            },
          ],
        };
      }

      case 'list_guilds': {
        const response = await discordClient.get('/users/@me/guilds');

        const guilds = response.data
          .map((guild: any) => `ID: ${guild.id}, Name: ${guild.name}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.length} guilds:\n\n${guilds}`,
            },
          ],
        };
      }

      case 'get_guild_members': {
        const validatedArgs = GetGuildMembersSchema.parse(args);
        const response = await discordClient.get(
          `/guilds/${validatedArgs.guild_id}/members`,
          {
            params: { limit: validatedArgs.limit },
          }
        );

        const members = response.data
          .map(
            (member: any) =>
              `ID: ${member.user.id}, Username: ${member.user.username}, Nick: ${member.nick || 'N/A'}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${response.data.length} members:\n\n${members}`,
            },
          ],
        };
      }

      case 'get_guild_member': {
        const validatedArgs = GetGuildMemberSchema.parse(args);
        const response = await discordClient.get(
          `/guilds/${validatedArgs.guild_id}/members/${validatedArgs.user_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Member details:\nUser ID: ${response.data.user.id}\nUsername: ${response.data.user.username}\nNick: ${response.data.nick || 'N/A'}\nRoles: ${response.data.roles.join(', ') || 'none'}`,
            },
          ],
        };
      }

      // Role operations
      case 'create_role': {
        const validatedArgs = CreateRoleSchema.parse(args);
        const response = await discordClient.post(`/guilds/${validatedArgs.guild_id}/roles`, {
          name: validatedArgs.name,
          permissions: validatedArgs.permissions,
          color: validatedArgs.color,
          hoist: validatedArgs.hoist,
          mentionable: validatedArgs.mentionable,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Role created successfully:\nID: ${response.data.id}\nName: ${response.data.name}`,
            },
          ],
        };
      }

      case 'update_role': {
        const validatedArgs = UpdateRoleSchema.parse(args);
        const updateData: any = {};
        if (validatedArgs.name) updateData.name = validatedArgs.name;
        if (validatedArgs.permissions) updateData.permissions = validatedArgs.permissions;
        if (validatedArgs.color !== undefined) updateData.color = validatedArgs.color;
        if (validatedArgs.hoist !== undefined) updateData.hoist = validatedArgs.hoist;
        if (validatedArgs.mentionable !== undefined)
          updateData.mentionable = validatedArgs.mentionable;

        const response = await discordClient.patch(
          `/guilds/${validatedArgs.guild_id}/roles/${validatedArgs.role_id}`,
          updateData
        );

        return {
          content: [
            {
              type: 'text',
              text: `Role ${response.data.id} updated successfully`,
            },
          ],
        };
      }

      case 'delete_role': {
        const validatedArgs = DeleteRoleSchema.parse(args);
        await discordClient.delete(
          `/guilds/${validatedArgs.guild_id}/roles/${validatedArgs.role_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Role ${validatedArgs.role_id} deleted successfully`,
            },
          ],
        };
      }

      case 'add_member_role': {
        const validatedArgs = AddMemberRoleSchema.parse(args);
        await discordClient.put(
          `/guilds/${validatedArgs.guild_id}/members/${validatedArgs.user_id}/roles/${validatedArgs.role_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Role ${validatedArgs.role_id} added to user ${validatedArgs.user_id}`,
            },
          ],
        };
      }

      case 'remove_member_role': {
        const validatedArgs = RemoveMemberRoleSchema.parse(args);
        await discordClient.delete(
          `/guilds/${validatedArgs.guild_id}/members/${validatedArgs.user_id}/roles/${validatedArgs.role_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Role ${validatedArgs.role_id} removed from user ${validatedArgs.user_id}`,
            },
          ],
        };
      }

      // Message editing and pinning
      case 'edit_message': {
        const validatedArgs = EditMessageSchema.parse(args);
        const updateData: any = {};
        if (validatedArgs.content !== undefined) updateData.content = validatedArgs.content;
        if (validatedArgs.embeds !== undefined) updateData.embeds = validatedArgs.embeds;
        const response = await discordClient.patch(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}`,
          updateData
        );
        return {
          content: [{ type: 'text', text: `Message ${response.data.id} edited successfully` }],
        };
      }

      case 'pin_message': {
        const validatedArgs = PinMessageSchema.parse(args);
        await discordClient.put(
          `/channels/${validatedArgs.channel_id}/pins/${validatedArgs.message_id}`
        );
        return {
          content: [{ type: 'text', text: `Message ${validatedArgs.message_id} pinned` }],
        };
      }

      case 'unpin_message': {
        const validatedArgs = UnpinMessageSchema.parse(args);
        await discordClient.delete(
          `/channels/${validatedArgs.channel_id}/pins/${validatedArgs.message_id}`
        );
        return {
          content: [{ type: 'text', text: `Message ${validatedArgs.message_id} unpinned` }],
        };
      }

      case 'get_pinned_messages': {
        const validatedArgs = GetPinnedMessagesSchema.parse(args);
        const response = await discordClient.get(
          `/channels/${validatedArgs.channel_id}/pins`
        );
        const messages = response.data
          .map((msg: any) => {
            const parts: string[] = [];
            if (msg.content) parts.push(msg.content);
            if (msg.embeds?.length) {
              for (const embed of msg.embeds) {
                const embedParts: string[] = [];
                if (embed.title) embedParts.push(`**${embed.title}**`);
                if (embed.description) embedParts.push(embed.description);
                if (embed.fields?.length) {
                  for (const field of embed.fields) embedParts.push(`${field.name}: ${field.value}`);
                }
                if (embed.url) embedParts.push(`URL: ${embed.url}`);
                if (embedParts.length) parts.push(`[Embed] ${embedParts.join(' | ')}`);
              }
            }
            if (msg.attachments?.length) {
              for (const att of msg.attachments) parts.push(`[Attachment] ${att.filename}: ${att.url}`);
            }
            return `[${msg.timestamp}] (msg_id: ${msg.id}) ${msg.author.username} (user_id: ${msg.author.id}): ${parts.join('\n') || '[no readable content]'}`;
          })
          .join('\n');
        return {
          content: [{ type: 'text', text: `${response.data.length} pinned messages:\n\n${messages}` }],
        };
      }

      // Thread operations
      case 'create_thread': {
        const validatedArgs = CreateThreadSchema.parse(args);
        const threadData: any = {
          name: validatedArgs.name,
          auto_archive_duration: validatedArgs.auto_archive_duration ?? 1440,
        };
        if (validatedArgs.type !== undefined) threadData.type = validatedArgs.type;

        const url = validatedArgs.message_id
          ? `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}/threads`
          : `/channels/${validatedArgs.channel_id}/threads`;

        const response = await discordClient.post(url, threadData);
        return {
          content: [{ type: 'text', text: `Thread created:\nID: ${response.data.id}\nName: ${response.data.name}` }],
        };
      }

      // Reaction operations
      case 'remove_reaction': {
        const validatedArgs = RemoveReactionSchema.parse(args);
        const target = validatedArgs.user_id ? validatedArgs.user_id : '@me';
        await discordClient.delete(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}/reactions/${encodeURIComponent(validatedArgs.emoji)}/${target}`
        );
        return {
          content: [{ type: 'text', text: `Reaction ${validatedArgs.emoji} removed` }],
        };
      }

      case 'get_reactions': {
        const validatedArgs = GetReactionsSchema.parse(args);
        const response = await discordClient.get(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}/reactions/${encodeURIComponent(validatedArgs.emoji)}`,
          { params: { limit: validatedArgs.limit } }
        );
        const users = response.data.map((u: any) => `${u.username} (${u.id})`).join('\n');
        return {
          content: [{ type: 'text', text: `${response.data.length} reactions:\n${users}` }],
        };
      }

      // Moderation operations
      case 'kick_member': {
        const validatedArgs = KickMemberSchema.parse(args);
        await discordClient.delete(
          `/guilds/${validatedArgs.guild_id}/members/${validatedArgs.user_id}`
        );
        return {
          content: [{ type: 'text', text: `User ${validatedArgs.user_id} kicked from guild` }],
        };
      }

      case 'ban_member': {
        const validatedArgs = BanMemberSchema.parse(args);
        const banData: any = {};
        if (validatedArgs.delete_message_seconds !== undefined)
          banData.delete_message_seconds = validatedArgs.delete_message_seconds;
        await discordClient.put(
          `/guilds/${validatedArgs.guild_id}/bans/${validatedArgs.user_id}`,
          banData
        );
        return {
          content: [{ type: 'text', text: `User ${validatedArgs.user_id} banned from guild` }],
        };
      }

      case 'unban_member': {
        const validatedArgs = UnbanMemberSchema.parse(args);
        await discordClient.delete(
          `/guilds/${validatedArgs.guild_id}/bans/${validatedArgs.user_id}`
        );
        return {
          content: [{ type: 'text', text: `User ${validatedArgs.user_id} unbanned` }],
        };
      }

      // Invite operations
      case 'create_invite': {
        const validatedArgs = CreateInviteSchema.parse(args);
        const response = await discordClient.post(
          `/channels/${validatedArgs.channel_id}/invites`,
          {
            max_age: validatedArgs.max_age ?? 86400,
            max_uses: validatedArgs.max_uses ?? 0,
            temporary: validatedArgs.temporary ?? false,
            unique: validatedArgs.unique ?? false,
          }
        );
        return {
          content: [{ type: 'text', text: `Invite created: https://discord.gg/${response.data.code}\nExpires: ${response.data.max_age === 0 ? 'never' : `in ${response.data.max_age}s`}\nMax uses: ${response.data.max_uses === 0 ? 'unlimited' : response.data.max_uses}` }],
        };
      }

      case 'delete_invite': {
        const validatedArgs = DeleteInviteSchema.parse(args);
        await discordClient.delete(`/invites/${validatedArgs.invite_code}`);
        return {
          content: [{ type: 'text', text: `Invite ${validatedArgs.invite_code} deleted` }],
        };
      }

      // DM operations
      case 'create_dm': {
        const validatedArgs = CreateDMSchema.parse(args);
        const response = await discordClient.post('/users/@me/channels', {
          recipient_id: validatedArgs.recipient_id,
        });
        return {
          content: [{ type: 'text', text: `DM channel opened:\nChannel ID: ${response.data.id}\nUse send_message with this channel_id to send a DM.` }],
        };
      }

      // User operations
      case 'get_current_user': {
        const response = await discordClient.get('/users/@me');

        return {
          content: [
            {
              type: 'text',
              text: `Current user:\nID: ${response.data.id}\nUsername: ${response.data.username}\nEmail: ${response.data.email || 'N/A'}`,
            },
          ],
        };
      }

      case 'get_user': {
        const validatedArgs = GetUserSchema.parse(args);
        const response = await discordClient.get(`/users/${validatedArgs.user_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `User details:\nID: ${response.data.id}\nUsername: ${response.data.username}\nBot: ${response.data.bot || false}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
}
