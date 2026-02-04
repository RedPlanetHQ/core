import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Discord API client
let discordClient: AxiosInstance;
let botToken: string | null = null;

/**
 * Initialize Discord client with OAuth credentials
 */
async function initializeClient(
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  // Try to refresh token if refresh_token exists
  if (credentials.refresh_token) {
    try {
      const tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: client_id,
          client_secret: client_secret,
          refresh_token: credentials.refresh_token,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      credentials.access_token = tokenResponse.data.access_token;
      if (tokenResponse.data.refresh_token) {
        credentials.refresh_token = tokenResponse.data.refresh_token;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }

  // Store bot token if available (for bot operations)
  botToken = credentials.bot_token || null;

  discordClient = axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: {
      Authorization: botToken ? `Bot ${botToken}` : `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
    },
  });
}

// Schema definitions for Messages
const SendMessageSchema = z.object({
  channel_id: z.string().describe('Channel ID to send the message to'),
  content: z.string().describe('Message content (up to 2000 characters)'),
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
      description: 'Sends a message to a Discord channel',
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
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  await initializeClient(client_id, client_secret, callback, credentials);

  try {
    switch (name) {
      // Message operations
      case 'send_message': {
        const validatedArgs = SendMessageSchema.parse(args);
        const response = await discordClient.post(
          `/channels/${validatedArgs.channel_id}/messages`,
          {
            content: validatedArgs.content,
            tts: validatedArgs.tts,
            embeds: validatedArgs.embeds,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully:\nMessage ID: ${response.data.id}\nChannel: ${response.data.channel_id}`,
            },
          ],
        };
      }

      case 'get_message': {
        const validatedArgs = GetMessageSchema.parse(args);
        const response = await discordClient.get(
          `/channels/${validatedArgs.channel_id}/messages/${validatedArgs.message_id}`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Message details:\nAuthor: ${response.data.author.username}\nContent: ${response.data.content}\nTimestamp: ${response.data.timestamp}`,
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
          .map(
            (msg: any) =>
              `[${msg.timestamp}] ${msg.author.username}: ${msg.content || '[embed/attachment]'}`
          )
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

        return {
          content: [
            {
              type: 'text',
              text: `Channel details:\nID: ${response.data.id}\nName: ${response.data.name}\nType: ${response.data.type}\nTopic: ${response.data.topic || 'N/A'}`,
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
          .map((ch: any) => `ID: ${ch.id}, Name: ${ch.name}, Type: ${ch.type}`)
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
              text: `Member details:\nUsername: ${response.data.user.username}\nNick: ${response.data.nick || 'N/A'}\nRoles: ${response.data.roles.join(', ')}`,
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
