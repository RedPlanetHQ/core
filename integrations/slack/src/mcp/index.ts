import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

// Slack API client
let slackClient: AxiosInstance;

/**
 * Initialize Slack API client with access token
 */
async function initializeSlackClient(accessToken: string) {
  slackClient = axios.create({
    baseURL: 'https://slack.com/api',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * Execute a Slack API call
 */
async function executeSlackAPI(method: string, data?: Record<string, any>) {
  try {
    const response = await slackClient.post(`/${method}`, data);

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error || 'Unknown error'}`);
    }

    return response.data;
  } catch (error: any) {
    throw new Error(
      `Slack API error: ${error.response?.data?.error || error.message}`
    );
  }
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// Message Schemas
const SendMessageSchema = z.object({
  channel: z.string().describe('Channel ID to send message to'),
  text: z.string().describe('Message text content'),
  thread_ts: z.string().optional().describe('Thread timestamp to reply in thread'),
  blocks: z.array(z.any()).optional().describe('Array of Block Kit blocks'),
  attachments: z.array(z.any()).optional().describe('Array of legacy attachments'),
  unfurl_links: z.boolean().optional().describe('Enable link unfurling'),
  unfurl_media: z.boolean().optional().describe('Enable media unfurling'),
});

const UpdateMessageSchema = z.object({
  channel: z.string().describe('Channel ID containing the message'),
  ts: z.string().describe('Timestamp of the message to update'),
  text: z.string().describe('New message text'),
  blocks: z.array(z.any()).optional().describe('New Block Kit blocks'),
  attachments: z.array(z.any()).optional().describe('New attachments'),
});

const DeleteMessageSchema = z.object({
  channel: z.string().describe('Channel ID containing the message'),
  ts: z.string().describe('Timestamp of the message to delete'),
});

const GetMessageSchema = z.object({
  channel: z.string().describe('Channel ID'),
  ts: z.string().describe('Message timestamp'),
});

const ListMessagesSchema = z.object({
  channel: z.string().describe('Channel ID to fetch messages from'),
  limit: z.number().optional().default(100).describe('Number of messages to return (max 1000)'),
  oldest: z.string().optional().describe('Start of time range (timestamp)'),
  latest: z.string().optional().describe('End of time range (timestamp)'),
  inclusive: z.boolean().optional().describe('Include messages with oldest/latest timestamps'),
});

const SearchMessagesSchema = z.object({
  query: z.string().describe('Search query'),
  count: z.number().optional().default(20).describe('Number of results to return'),
  sort: z.enum(['score', 'timestamp']).optional().describe('Sort order'),
  sort_dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
});

// Reaction Schemas
const AddReactionSchema = z.object({
  channel: z.string().describe('Channel ID'),
  timestamp: z.string().describe('Message timestamp'),
  name: z.string().describe('Reaction name (without colons, e.g., "thumbsup")'),
});

const RemoveReactionSchema = z.object({
  channel: z.string().describe('Channel ID'),
  timestamp: z.string().describe('Message timestamp'),
  name: z.string().describe('Reaction name to remove'),
});

const GetReactionsSchema = z.object({
  channel: z.string().describe('Channel ID'),
  timestamp: z.string().describe('Message timestamp'),
});

// Channel Schemas
const ListChannelsSchema = z.object({
  exclude_archived: z.boolean().optional().default(true).describe('Exclude archived channels'),
  types: z.string().optional().default('public_channel,private_channel').describe('Channel types (comma-separated: public_channel,private_channel,mpim,im)'),
  limit: z.number().optional().default(100).describe('Number of channels to return'),
});

const GetChannelSchema = z.object({
  channel: z.string().describe('Channel ID'),
});

const CreateChannelSchema = z.object({
  name: z.string().describe('Channel name (without # prefix)'),
  is_private: z.boolean().optional().default(false).describe('Create as private channel'),
  description: z.string().optional().describe('Channel description'),
});

const ArchiveChannelSchema = z.object({
  channel: z.string().describe('Channel ID to archive'),
});

const UnarchiveChannelSchema = z.object({
  channel: z.string().describe('Channel ID to unarchive'),
});

const InviteToChannelSchema = z.object({
  channel: z.string().describe('Channel ID'),
  users: z.string().describe('Comma-separated list of user IDs to invite'),
});

const KickFromChannelSchema = z.object({
  channel: z.string().describe('Channel ID'),
  user: z.string().describe('User ID to remove'),
});

const JoinChannelSchema = z.object({
  channel: z.string().describe('Channel ID to join'),
});

const LeaveChannelSchema = z.object({
  channel: z.string().describe('Channel ID to leave'),
});

const RenameChannelSchema = z.object({
  channel: z.string().describe('Channel ID'),
  name: z.string().describe('New channel name'),
});

const SetChannelTopicSchema = z.object({
  channel: z.string().describe('Channel ID'),
  topic: z.string().describe('New topic'),
});

const SetChannelPurposeSchema = z.object({
  channel: z.string().describe('Channel ID'),
  purpose: z.string().describe('New purpose'),
});

// User Schemas
const ListUsersSchema = z.object({
  limit: z.number().optional().default(100).describe('Number of users to return'),
});

const GetUserSchema = z.object({
  user: z.string().describe('User ID'),
});

const GetUserByEmailSchema = z.object({
  email: z.string().describe('User email address'),
});

const GetUserPresenceSchema = z.object({
  user: z.string().describe('User ID'),
});

const SetUserPresenceSchema = z.object({
  presence: z.enum(['auto', 'away']).describe('Presence state'),
});

// Direct Message Schemas
const OpenDMSchema = z.object({
  users: z.string().describe('Comma-separated list of user IDs (1 for DM, 2+ for group DM)'),
});

// File Schemas
const UploadFileSchema = z.object({
  channels: z.string().optional().describe('Comma-separated list of channel IDs'),
  content: z.string().optional().describe('File content'),
  filename: z.string().optional().describe('Filename'),
  title: z.string().optional().describe('File title'),
  initial_comment: z.string().optional().describe('Initial comment about the file'),
  thread_ts: z.string().optional().describe('Thread timestamp to upload file to'),
});

const ListFilesSchema = z.object({
  channel: z.string().optional().describe('Filter by channel ID'),
  user: z.string().optional().describe('Filter by user ID'),
  count: z.number().optional().default(100).describe('Number of files to return'),
  types: z.string().optional().describe('File types (comma-separated: all,spaces,snippets,images,gdocs,zips,pdfs)'),
});

const GetFileSchema = z.object({
  file: z.string().describe('File ID'),
});

const DeleteFileSchema = z.object({
  file: z.string().describe('File ID to delete'),
});

// Reminder Schemas
const CreateReminderSchema = z.object({
  text: z.string().describe('Reminder text'),
  time: z.string().describe('Time for the reminder (Unix timestamp or natural language)'),
  user: z.string().optional().describe('User ID to send reminder to (defaults to authenticated user)'),
});

const ListRemindersSchema = z.object({});

const DeleteReminderSchema = z.object({
  reminder: z.string().describe('Reminder ID to delete'),
});

// Star Schemas
const AddStarSchema = z.object({
  channel: z.string().optional().describe('Channel ID'),
  timestamp: z.string().optional().describe('Message timestamp'),
  file: z.string().optional().describe('File ID'),
});

const RemoveStarSchema = z.object({
  channel: z.string().optional().describe('Channel ID'),
  timestamp: z.string().optional().describe('Message timestamp'),
  file: z.string().optional().describe('File ID'),
});

const ListStarsSchema = z.object({
  count: z.number().optional().default(100).describe('Number of starred items to return'),
});

// Workspace Schemas
const GetTeamInfoSchema = z.object({});

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export async function getTools() {
  return [
    // Message Management
    {
      name: 'slack_send_message',
      description: 'Sends a message to a Slack channel or DM',
      inputSchema: zodToJsonSchema(SendMessageSchema),
    },
    {
      name: 'slack_update_message',
      description: 'Updates an existing message',
      inputSchema: zodToJsonSchema(UpdateMessageSchema),
    },
    {
      name: 'slack_delete_message',
      description: 'Deletes a message',
      inputSchema: zodToJsonSchema(DeleteMessageSchema),
    },
    {
      name: 'slack_get_message',
      description: 'Gets details of a specific message',
      inputSchema: zodToJsonSchema(GetMessageSchema),
    },
    {
      name: 'slack_list_messages',
      description: 'Lists messages from a channel',
      inputSchema: zodToJsonSchema(ListMessagesSchema),
    },
    {
      name: 'slack_search_messages',
      description: 'Searches for messages across workspace',
      inputSchema: zodToJsonSchema(SearchMessagesSchema),
    },

    // Reactions
    {
      name: 'slack_add_reaction',
      description: 'Adds a reaction emoji to a message',
      inputSchema: zodToJsonSchema(AddReactionSchema),
    },
    {
      name: 'slack_remove_reaction',
      description: 'Removes a reaction from a message',
      inputSchema: zodToJsonSchema(RemoveReactionSchema),
    },
    {
      name: 'slack_get_reactions',
      description: 'Gets all reactions on a message',
      inputSchema: zodToJsonSchema(GetReactionsSchema),
    },

    // Channel Management
    {
      name: 'slack_list_channels',
      description: 'Lists all channels in workspace',
      inputSchema: zodToJsonSchema(ListChannelsSchema),
    },
    {
      name: 'slack_get_channel',
      description: 'Gets details of a specific channel',
      inputSchema: zodToJsonSchema(GetChannelSchema),
    },
    {
      name: 'slack_create_channel',
      description: 'Creates a new channel',
      inputSchema: zodToJsonSchema(CreateChannelSchema),
    },
    {
      name: 'slack_archive_channel',
      description: 'Archives a channel',
      inputSchema: zodToJsonSchema(ArchiveChannelSchema),
    },
    {
      name: 'slack_unarchive_channel',
      description: 'Unarchives a channel',
      inputSchema: zodToJsonSchema(UnarchiveChannelSchema),
    },
    {
      name: 'slack_invite_to_channel',
      description: 'Invites users to a channel',
      inputSchema: zodToJsonSchema(InviteToChannelSchema),
    },
    {
      name: 'slack_kick_from_channel',
      description: 'Removes a user from a channel',
      inputSchema: zodToJsonSchema(KickFromChannelSchema),
    },
    {
      name: 'slack_join_channel',
      description: 'Joins a channel',
      inputSchema: zodToJsonSchema(JoinChannelSchema),
    },
    {
      name: 'slack_leave_channel',
      description: 'Leaves a channel',
      inputSchema: zodToJsonSchema(LeaveChannelSchema),
    },
    {
      name: 'slack_rename_channel',
      description: 'Renames a channel',
      inputSchema: zodToJsonSchema(RenameChannelSchema),
    },
    {
      name: 'slack_set_channel_topic',
      description: 'Sets channel topic',
      inputSchema: zodToJsonSchema(SetChannelTopicSchema),
    },
    {
      name: 'slack_set_channel_purpose',
      description: 'Sets channel purpose',
      inputSchema: zodToJsonSchema(SetChannelPurposeSchema),
    },

    // User Management
    {
      name: 'slack_list_users',
      description: 'Lists all users in workspace',
      inputSchema: zodToJsonSchema(ListUsersSchema),
    },
    {
      name: 'slack_get_user',
      description: 'Gets details of a specific user',
      inputSchema: zodToJsonSchema(GetUserSchema),
    },
    {
      name: 'slack_get_user_by_email',
      description: 'Finds a user by email address',
      inputSchema: zodToJsonSchema(GetUserByEmailSchema),
    },
    {
      name: 'slack_get_user_presence',
      description: 'Gets user presence status',
      inputSchema: zodToJsonSchema(GetUserPresenceSchema),
    },
    {
      name: 'slack_set_user_presence',
      description: 'Sets your presence status',
      inputSchema: zodToJsonSchema(SetUserPresenceSchema),
    },

    // Direct Messages
    {
      name: 'slack_open_dm',
      description: 'Opens a direct message or group DM',
      inputSchema: zodToJsonSchema(OpenDMSchema),
    },

    // File Management
    {
      name: 'slack_upload_file',
      description: 'Uploads a file to Slack',
      inputSchema: zodToJsonSchema(UploadFileSchema),
    },
    {
      name: 'slack_list_files',
      description: 'Lists files in workspace',
      inputSchema: zodToJsonSchema(ListFilesSchema),
    },
    {
      name: 'slack_get_file',
      description: 'Gets details of a specific file',
      inputSchema: zodToJsonSchema(GetFileSchema),
    },
    {
      name: 'slack_delete_file',
      description: 'Deletes a file',
      inputSchema: zodToJsonSchema(DeleteFileSchema),
    },

    // Reminders
    {
      name: 'slack_create_reminder',
      description: 'Creates a reminder',
      inputSchema: zodToJsonSchema(CreateReminderSchema),
    },
    {
      name: 'slack_list_reminders',
      description: 'Lists all reminders',
      inputSchema: zodToJsonSchema(ListRemindersSchema),
    },
    {
      name: 'slack_delete_reminder',
      description: 'Deletes a reminder',
      inputSchema: zodToJsonSchema(DeleteReminderSchema),
    },

    // Stars
    {
      name: 'slack_add_star',
      description: 'Stars a message or file',
      inputSchema: zodToJsonSchema(AddStarSchema),
    },
    {
      name: 'slack_remove_star',
      description: 'Removes a star from message or file',
      inputSchema: zodToJsonSchema(RemoveStarSchema),
    },
    {
      name: 'slack_list_stars',
      description: 'Lists all starred items',
      inputSchema: zodToJsonSchema(ListStarsSchema),
    },

    // Workspace Info
    {
      name: 'slack_get_team_info',
      description: 'Gets workspace/team information',
      inputSchema: zodToJsonSchema(GetTeamInfoSchema),
    },
  ];
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  accessToken: string
) {
  // Initialize client if not already done
  if (!slackClient) {
    await initializeSlackClient(accessToken);
  }

  try {
    switch (name) {
      // ====================================================================
      // MESSAGE OPERATIONS
      // ====================================================================
      case 'slack_send_message': {
        const validatedArgs = SendMessageSchema.parse(args);
        const data = await executeSlackAPI('chat.postMessage', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Message sent to <#${validatedArgs.channel}>\nTimestamp: ${data.ts}\nChannel: ${data.channel}`,
          }],
        };
      }

      case 'slack_update_message': {
        const validatedArgs = UpdateMessageSchema.parse(args);
        const data = await executeSlackAPI('chat.update', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Message updated\nTimestamp: ${data.ts}\nChannel: ${data.channel}`,
          }],
        };
      }

      case 'slack_delete_message': {
        const validatedArgs = DeleteMessageSchema.parse(args);
        await executeSlackAPI('chat.delete', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Message deleted from <#${validatedArgs.channel}>`,
          }],
        };
      }

      case 'slack_get_message': {
        const validatedArgs = GetMessageSchema.parse(args);
        const data = await executeSlackAPI('conversations.history', {
          channel: validatedArgs.channel,
          latest: validatedArgs.ts,
          limit: 1,
          inclusive: true,
        });

        const message = data.messages[0];
        if (!message) {
          return {
            content: [{ type: 'text', text: 'Message not found' }],
          };
        }

        let text = `Message in <#${validatedArgs.channel}>:\n`;
        text += `From: <@${message.user}>\n`;
        text += `Timestamp: ${message.ts}\n`;
        text += `Text: ${message.text}\n`;
        if (message.thread_ts) text += `Thread: ${message.thread_ts}\n`;
        if (message.reactions) {
          text += `Reactions: ${message.reactions.map((r: any) => `${r.name} (${r.count})`).join(', ')}\n`;
        }

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_list_messages': {
        const validatedArgs = ListMessagesSchema.parse(args);
        const data = await executeSlackAPI('conversations.history', validatedArgs);

        if (!data.messages || data.messages.length === 0) {
          return {
            content: [{ type: 'text', text: 'No messages found' }],
          };
        }

        let text = `Found ${data.messages.length} message(s) in <#${validatedArgs.channel}>:\n\n`;
        data.messages.slice(0, 20).forEach((msg: any) => {
          text += `[${msg.ts}] <@${msg.user}>: ${msg.text?.substring(0, 100)}${msg.text?.length > 100 ? '...' : ''}\n`;
        });

        if (data.messages.length > 20) {
          text += `\n... and ${data.messages.length - 20} more messages`;
        }

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_search_messages': {
        const validatedArgs = SearchMessagesSchema.parse(args);
        const data = await executeSlackAPI('search.messages', validatedArgs);

        if (!data.messages || data.messages.matches.length === 0) {
          return {
            content: [{ type: 'text', text: 'No messages found' }],
          };
        }

        let text = `Found ${data.messages.total} message(s):\n\n`;
        data.messages.matches.slice(0, 10).forEach((msg: any) => {
          text += `In <#${msg.channel.id}>: ${msg.text?.substring(0, 100)}\n`;
          text += `  From: <@${msg.username}> at ${msg.ts}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // REACTION OPERATIONS
      // ====================================================================
      case 'slack_add_reaction': {
        const validatedArgs = AddReactionSchema.parse(args);
        await executeSlackAPI('reactions.add', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Added :${validatedArgs.name}: reaction`,
          }],
        };
      }

      case 'slack_remove_reaction': {
        const validatedArgs = RemoveReactionSchema.parse(args);
        await executeSlackAPI('reactions.remove', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Removed :${validatedArgs.name}: reaction`,
          }],
        };
      }

      case 'slack_get_reactions': {
        const validatedArgs = GetReactionsSchema.parse(args);
        const data = await executeSlackAPI('reactions.get', validatedArgs);

        const message = data.message;
        if (!message.reactions || message.reactions.length === 0) {
          return {
            content: [{ type: 'text', text: 'No reactions on this message' }],
          };
        }

        let text = `Reactions on message:\n`;
        message.reactions.forEach((r: any) => {
          text += `- :${r.name}: (${r.count}) by: ${r.users.map((u: string) => `<@${u}>`).join(', ')}\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // CHANNEL OPERATIONS
      // ====================================================================
      case 'slack_list_channels': {
        const validatedArgs = ListChannelsSchema.parse(args);
        const data = await executeSlackAPI('conversations.list', validatedArgs);

        if (!data.channels || data.channels.length === 0) {
          return {
            content: [{ type: 'text', text: 'No channels found' }],
          };
        }

        let text = `Found ${data.channels.length} channel(s):\n\n`;
        data.channels.forEach((ch: any) => {
          text += `<#${ch.id}> - ${ch.name}`;
          if (ch.is_private) text += ' 🔒';
          if (ch.is_archived) text += ' [archived]';
          text += `\n`;
          if (ch.purpose?.value) text += `  Purpose: ${ch.purpose.value}\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_get_channel': {
        const validatedArgs = GetChannelSchema.parse(args);
        const data = await executeSlackAPI('conversations.info', validatedArgs);

        const ch = data.channel;
        let text = `Channel: <#${ch.id}> (${ch.name})\n`;
        text += `Created: ${new Date(ch.created * 1000).toISOString()}\n`;
        text += `Private: ${ch.is_private ? 'Yes' : 'No'}\n`;
        text += `Archived: ${ch.is_archived ? 'Yes' : 'No'}\n`;
        text += `Members: ${ch.num_members || 'N/A'}\n`;
        if (ch.topic?.value) text += `Topic: ${ch.topic.value}\n`;
        if (ch.purpose?.value) text += `Purpose: ${ch.purpose.value}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_create_channel': {
        const validatedArgs = CreateChannelSchema.parse(args);
        const data = await executeSlackAPI('conversations.create', validatedArgs);

        const ch = data.channel;
        return {
          content: [{
            type: 'text',
            text: `✓ Channel created: <#${ch.id}> (${ch.name})\nPrivate: ${ch.is_private ? 'Yes' : 'No'}`,
          }],
        };
      }

      case 'slack_archive_channel': {
        const validatedArgs = ArchiveChannelSchema.parse(args);
        await executeSlackAPI('conversations.archive', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Channel <#${validatedArgs.channel}> archived`,
          }],
        };
      }

      case 'slack_unarchive_channel': {
        const validatedArgs = UnarchiveChannelSchema.parse(args);
        await executeSlackAPI('conversations.unarchive', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Channel <#${validatedArgs.channel}> unarchived`,
          }],
        };
      }

      case 'slack_invite_to_channel': {
        const validatedArgs = InviteToChannelSchema.parse(args);
        await executeSlackAPI('conversations.invite', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Users invited to <#${validatedArgs.channel}>`,
          }],
        };
      }

      case 'slack_kick_from_channel': {
        const validatedArgs = KickFromChannelSchema.parse(args);
        await executeSlackAPI('conversations.kick', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ User <@${validatedArgs.user}> removed from <#${validatedArgs.channel}>`,
          }],
        };
      }

      case 'slack_join_channel': {
        const validatedArgs = JoinChannelSchema.parse(args);
        await executeSlackAPI('conversations.join', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Joined <#${validatedArgs.channel}>`,
          }],
        };
      }

      case 'slack_leave_channel': {
        const validatedArgs = LeaveChannelSchema.parse(args);
        await executeSlackAPI('conversations.leave', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Left <#${validatedArgs.channel}>`,
          }],
        };
      }

      case 'slack_rename_channel': {
        const validatedArgs = RenameChannelSchema.parse(args);
        const data = await executeSlackAPI('conversations.rename', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Channel renamed to: ${data.channel.name}`,
          }],
        };
      }

      case 'slack_set_channel_topic': {
        const validatedArgs = SetChannelTopicSchema.parse(args);
        await executeSlackAPI('conversations.setTopic', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Channel topic updated`,
          }],
        };
      }

      case 'slack_set_channel_purpose': {
        const validatedArgs = SetChannelPurposeSchema.parse(args);
        await executeSlackAPI('conversations.setPurpose', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Channel purpose updated`,
          }],
        };
      }

      // ====================================================================
      // USER OPERATIONS
      // ====================================================================
      case 'slack_list_users': {
        const validatedArgs = ListUsersSchema.parse(args);
        const data = await executeSlackAPI('users.list', validatedArgs);

        if (!data.members || data.members.length === 0) {
          return {
            content: [{ type: 'text', text: 'No users found' }],
          };
        }

        let text = `Found ${data.members.length} user(s):\n\n`;
        data.members.filter((u: any) => !u.is_bot && !u.deleted).forEach((user: any) => {
          text += `<@${user.id}> - ${user.real_name || user.name}`;
          if (user.profile?.email) text += ` (${user.profile.email})`;
          if (user.is_admin) text += ' [admin]';
          text += `\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_get_user': {
        const validatedArgs = GetUserSchema.parse(args);
        const data = await executeSlackAPI('users.info', validatedArgs);

        const user = data.user;
        let text = `User: <@${user.id}>\n`;
        text += `Name: ${user.real_name || user.name}\n`;
        if (user.profile?.email) text += `Email: ${user.profile.email}\n`;
        if (user.profile?.title) text += `Title: ${user.profile.title}\n`;
        text += `Admin: ${user.is_admin ? 'Yes' : 'No'}\n`;
        text += `Bot: ${user.is_bot ? 'Yes' : 'No'}\n`;
        if (user.tz) text += `Timezone: ${user.tz}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_get_user_by_email': {
        const validatedArgs = GetUserByEmailSchema.parse(args);
        const data = await executeSlackAPI('users.lookupByEmail', validatedArgs);

        const user = data.user;
        let text = `User: <@${user.id}>\n`;
        text += `Name: ${user.real_name || user.name}\n`;
        text += `Email: ${user.profile?.email}\n`;
        if (user.profile?.title) text += `Title: ${user.profile.title}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_get_user_presence': {
        const validatedArgs = GetUserPresenceSchema.parse(args);
        const data = await executeSlackAPI('users.getPresence', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `User <@${validatedArgs.user}> presence: ${data.presence}`,
          }],
        };
      }

      case 'slack_set_user_presence': {
        const validatedArgs = SetUserPresenceSchema.parse(args);
        await executeSlackAPI('users.setPresence', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Presence set to: ${validatedArgs.presence}`,
          }],
        };
      }

      // ====================================================================
      // DIRECT MESSAGE OPERATIONS
      // ====================================================================
      case 'slack_open_dm': {
        const validatedArgs = OpenDMSchema.parse(args);
        const data = await executeSlackAPI('conversations.open', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ DM opened\nChannel ID: ${data.channel.id}`,
          }],
        };
      }

      // ====================================================================
      // FILE OPERATIONS
      // ====================================================================
      case 'slack_upload_file': {
        const validatedArgs = UploadFileSchema.parse(args);
        const data = await executeSlackAPI('files.upload', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ File uploaded: ${data.file.name}\nFile ID: ${data.file.id}`,
          }],
        };
      }

      case 'slack_list_files': {
        const validatedArgs = ListFilesSchema.parse(args);
        const data = await executeSlackAPI('files.list', validatedArgs);

        if (!data.files || data.files.length === 0) {
          return {
            content: [{ type: 'text', text: 'No files found' }],
          };
        }

        let text = `Found ${data.files.length} file(s):\n\n`;
        data.files.slice(0, 20).forEach((file: any) => {
          text += `${file.name || 'Untitled'} (${file.filetype})\n`;
          text += `  Size: ${Math.round(file.size / 1024)} KB | Uploaded: ${new Date(file.created * 1000).toISOString()}\n`;
          text += `  ID: ${file.id}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_get_file': {
        const validatedArgs = GetFileSchema.parse(args);
        const data = await executeSlackAPI('files.info', validatedArgs);

        const file = data.file;
        let text = `File: ${file.name || 'Untitled'}\n`;
        text += `Type: ${file.filetype}\n`;
        text += `Size: ${Math.round(file.size / 1024)} KB\n`;
        text += `Uploaded: ${new Date(file.created * 1000).toISOString()}\n`;
        text += `By: <@${file.user}>\n`;
        if (file.url_private) text += `URL: ${file.url_private}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_delete_file': {
        const validatedArgs = DeleteFileSchema.parse(args);
        await executeSlackAPI('files.delete', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ File deleted`,
          }],
        };
      }

      // ====================================================================
      // REMINDER OPERATIONS
      // ====================================================================
      case 'slack_create_reminder': {
        const validatedArgs = CreateReminderSchema.parse(args);
        const data = await executeSlackAPI('reminders.add', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Reminder created\nID: ${data.reminder.id}\nTime: ${new Date(data.reminder.time * 1000).toISOString()}`,
          }],
        };
      }

      case 'slack_list_reminders': {
        const data = await executeSlackAPI('reminders.list', {});

        if (!data.reminders || data.reminders.length === 0) {
          return {
            content: [{ type: 'text', text: 'No reminders found' }],
          };
        }

        let text = `Found ${data.reminders.length} reminder(s):\n\n`;
        data.reminders.forEach((r: any) => {
          text += `${r.text}\n`;
          text += `  ID: ${r.id} | Time: ${new Date(r.time * 1000).toISOString()}\n\n`;
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'slack_delete_reminder': {
        const validatedArgs = DeleteReminderSchema.parse(args);
        await executeSlackAPI('reminders.delete', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Reminder deleted`,
          }],
        };
      }

      // ====================================================================
      // STAR OPERATIONS
      // ====================================================================
      case 'slack_add_star': {
        const validatedArgs = AddStarSchema.parse(args);
        await executeSlackAPI('stars.add', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Item starred`,
          }],
        };
      }

      case 'slack_remove_star': {
        const validatedArgs = RemoveStarSchema.parse(args);
        await executeSlackAPI('stars.remove', validatedArgs);

        return {
          content: [{
            type: 'text',
            text: `✓ Star removed`,
          }],
        };
      }

      case 'slack_list_stars': {
        const validatedArgs = ListStarsSchema.parse(args);
        const data = await executeSlackAPI('stars.list', validatedArgs);

        if (!data.items || data.items.length === 0) {
          return {
            content: [{ type: 'text', text: 'No starred items found' }],
          };
        }

        let text = `Found ${data.items.length} starred item(s):\n\n`;
        data.items.forEach((item: any) => {
          if (item.type === 'message') {
            text += `Message in <#${item.channel}>: ${item.message?.text?.substring(0, 80)}\n`;
          } else if (item.type === 'file') {
            text += `File: ${item.file?.name}\n`;
          } else {
            text += `${item.type}\n`;
          }
        });

        return {
          content: [{ type: 'text', text }],
        };
      }

      // ====================================================================
      // WORKSPACE OPERATIONS
      // ====================================================================
      case 'slack_get_team_info': {
        const data = await executeSlackAPI('team.info', {});

        const team = data.team;
        let text = `Workspace: ${team.name}\n`;
        text += `Domain: ${team.domain}.slack.com\n`;
        text += `ID: ${team.id}\n`;
        if (team.email_domain) text += `Email Domain: ${team.email_domain}\n`;

        return {
          content: [{ type: 'text', text }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
    };
  }
}
