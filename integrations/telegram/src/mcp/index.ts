import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { callTelegramApi, formatUser, formatChat } from '../utils';

// --- Schema definitions ---

const SendMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID or @channel username'),
  text: z.string().describe('Message text (up to 4096 characters)'),
  parse_mode: z
    .enum(['HTML', 'Markdown', 'MarkdownV2'])
    .optional()
    .describe('Text formatting mode'),
  disable_notification: z.boolean().optional().describe('Send silently'),
  reply_to_message_id: z.number().optional().describe('Message ID to reply to'),
});

const ForwardMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Target chat ID'),
  from_chat_id: z.union([z.string(), z.number()]).describe('Source chat ID'),
  message_id: z.number().describe('Message ID to forward'),
  disable_notification: z.boolean().optional().describe('Send silently'),
});

const EditMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  message_id: z.number().describe('Message ID to edit'),
  text: z.string().describe('New message text'),
  parse_mode: z
    .enum(['HTML', 'Markdown', 'MarkdownV2'])
    .optional()
    .describe('Text formatting mode'),
});

const DeleteMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  message_id: z.number().describe('Message ID to delete'),
});

const GetChatSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID or @channel username'),
});

const GetChatMembersCountSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
});

const GetChatMemberSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  user_id: z.number().describe('User ID'),
});

const SendPhotoSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  photo: z.string().describe('Photo URL or file_id'),
  caption: z.string().optional().describe('Photo caption (up to 1024 characters)'),
  parse_mode: z
    .enum(['HTML', 'Markdown', 'MarkdownV2'])
    .optional()
    .describe('Caption formatting mode'),
});

const SendDocumentSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  document: z.string().describe('Document URL or file_id'),
  caption: z.string().optional().describe('Document caption'),
});

const SetChatTitleSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  title: z.string().describe('New chat title (1-128 characters)'),
});

const SetChatDescriptionSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  description: z.string().optional().describe('New chat description (0-255 characters)'),
});

const PinMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  message_id: z.number().describe('Message ID to pin'),
  disable_notification: z.boolean().optional().describe('Pin silently'),
});

const UnpinMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  message_id: z.number().optional().describe('Message ID to unpin (unpins all if omitted)'),
});

const BanChatMemberSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  user_id: z.number().describe('User ID to ban'),
  until_date: z.number().optional().describe('Unix timestamp when the ban will be lifted'),
});

const UnbanChatMemberSchema = z.object({
  chat_id: z.union([z.string(), z.number()]).describe('Chat ID'),
  user_id: z.number().describe('User ID to unban'),
  only_if_banned: z.boolean().optional().default(true).describe('Only unban if currently banned'),
});

const GetMeSchema = z.object({});

/**
 * Get list of available tools
 */
export async function getTools() {
  return [
    // Message tools
    {
      name: 'send_message',
      description: 'Sends a text message to a Telegram chat',
      inputSchema: zodToJsonSchema(SendMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'forward_message',
      description: 'Forwards a message from one chat to another',
      inputSchema: zodToJsonSchema(ForwardMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'edit_message',
      description: 'Edits a previously sent message',
      inputSchema: zodToJsonSchema(EditMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_message',
      description: 'Deletes a message',
      inputSchema: zodToJsonSchema(DeleteMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Media tools
    {
      name: 'send_photo',
      description: 'Sends a photo to a Telegram chat',
      inputSchema: zodToJsonSchema(SendPhotoSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'send_document',
      description: 'Sends a document/file to a Telegram chat',
      inputSchema: zodToJsonSchema(SendDocumentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    // Chat tools
    {
      name: 'get_chat',
      description: 'Gets information about a Telegram chat',
      inputSchema: zodToJsonSchema(GetChatSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_chat_members_count',
      description: 'Gets the number of members in a chat',
      inputSchema: zodToJsonSchema(GetChatMembersCountSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_chat_member',
      description: 'Gets information about a member of a chat',
      inputSchema: zodToJsonSchema(GetChatMemberSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Chat management tools
    {
      name: 'set_chat_title',
      description: 'Changes the title of a chat',
      inputSchema: zodToJsonSchema(SetChatTitleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'set_chat_description',
      description: 'Changes the description of a chat',
      inputSchema: zodToJsonSchema(SetChatDescriptionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'pin_message',
      description: 'Pins a message in a chat',
      inputSchema: zodToJsonSchema(PinMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'unpin_message',
      description: 'Unpins a message (or all messages) in a chat',
      inputSchema: zodToJsonSchema(UnpinMessageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Moderation tools
    {
      name: 'ban_chat_member',
      description: 'Bans a user from a group or channel',
      inputSchema: zodToJsonSchema(BanChatMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'unban_chat_member',
      description: 'Unbans a user from a group or channel',
      inputSchema: zodToJsonSchema(UnbanChatMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Bot info
    {
      name: 'get_me',
      description: 'Gets basic information about the bot',
      inputSchema: zodToJsonSchema(GetMeSchema),
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
  if (!botToken) {
    return {
      content: [{ type: 'text', text: 'Error: Bot token is not configured' }],
    };
  }

  try {
    switch (name) {
      // Message operations
      case 'send_message': {
        const validated = SendMessageSchema.parse(args);
        const result = await callTelegramApi(botToken, 'sendMessage', {
          chat_id: validated.chat_id,
          text: validated.text,
          parse_mode: validated.parse_mode,
          disable_notification: validated.disable_notification,
          reply_to_message_id: validated.reply_to_message_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully:\nMessage ID: ${result.message_id}\nChat: ${formatChat(result.chat)}`,
            },
          ],
        };
      }

      case 'forward_message': {
        const validated = ForwardMessageSchema.parse(args);
        const result = await callTelegramApi(botToken, 'forwardMessage', {
          chat_id: validated.chat_id,
          from_chat_id: validated.from_chat_id,
          message_id: validated.message_id,
          disable_notification: validated.disable_notification,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message forwarded successfully:\nNew Message ID: ${result.message_id}\nTo: ${formatChat(result.chat)}`,
            },
          ],
        };
      }

      case 'edit_message': {
        const validated = EditMessageSchema.parse(args);
        const result = await callTelegramApi(botToken, 'editMessageText', {
          chat_id: validated.chat_id,
          message_id: validated.message_id,
          text: validated.text,
          parse_mode: validated.parse_mode,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message ${validated.message_id} edited successfully`,
            },
          ],
        };
      }

      case 'delete_message': {
        const validated = DeleteMessageSchema.parse(args);
        await callTelegramApi(botToken, 'deleteMessage', {
          chat_id: validated.chat_id,
          message_id: validated.message_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message ${validated.message_id} deleted successfully`,
            },
          ],
        };
      }

      // Media operations
      case 'send_photo': {
        const validated = SendPhotoSchema.parse(args);
        const result = await callTelegramApi(botToken, 'sendPhoto', {
          chat_id: validated.chat_id,
          photo: validated.photo,
          caption: validated.caption,
          parse_mode: validated.parse_mode,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Photo sent successfully:\nMessage ID: ${result.message_id}\nChat: ${formatChat(result.chat)}`,
            },
          ],
        };
      }

      case 'send_document': {
        const validated = SendDocumentSchema.parse(args);
        const result = await callTelegramApi(botToken, 'sendDocument', {
          chat_id: validated.chat_id,
          document: validated.document,
          caption: validated.caption,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Document sent successfully:\nMessage ID: ${result.message_id}\nChat: ${formatChat(result.chat)}`,
            },
          ],
        };
      }

      // Chat info operations
      case 'get_chat': {
        const validated = GetChatSchema.parse(args);
        const result = await callTelegramApi(botToken, 'getChat', {
          chat_id: validated.chat_id,
        });

        const info = [
          `Chat details:`,
          `ID: ${result.id}`,
          `Type: ${result.type}`,
          `Title: ${result.title || 'N/A'}`,
          `Username: ${result.username ? '@' + result.username : 'N/A'}`,
          `Description: ${result.description || 'N/A'}`,
          `Members: ${result.member_count || 'N/A'}`,
        ];

        return {
          content: [{ type: 'text', text: info.join('\n') }],
        };
      }

      case 'get_chat_members_count': {
        const validated = GetChatMembersCountSchema.parse(args);
        const result = await callTelegramApi(botToken, 'getChatMemberCount', {
          chat_id: validated.chat_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Chat has ${result} members`,
            },
          ],
        };
      }

      case 'get_chat_member': {
        const validated = GetChatMemberSchema.parse(args);
        const result = await callTelegramApi(botToken, 'getChatMember', {
          chat_id: validated.chat_id,
          user_id: validated.user_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Member details:\nUser: ${formatUser(result.user)}\nStatus: ${result.status}\nIs Bot: ${result.user.is_bot}`,
            },
          ],
        };
      }

      // Chat management
      case 'set_chat_title': {
        const validated = SetChatTitleSchema.parse(args);
        await callTelegramApi(botToken, 'setChatTitle', {
          chat_id: validated.chat_id,
          title: validated.title,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Chat title updated to "${validated.title}"`,
            },
          ],
        };
      }

      case 'set_chat_description': {
        const validated = SetChatDescriptionSchema.parse(args);
        await callTelegramApi(botToken, 'setChatDescription', {
          chat_id: validated.chat_id,
          description: validated.description || '',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Chat description updated`,
            },
          ],
        };
      }

      case 'pin_message': {
        const validated = PinMessageSchema.parse(args);
        await callTelegramApi(botToken, 'pinChatMessage', {
          chat_id: validated.chat_id,
          message_id: validated.message_id,
          disable_notification: validated.disable_notification,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message ${validated.message_id} pinned successfully`,
            },
          ],
        };
      }

      case 'unpin_message': {
        const validated = UnpinMessageSchema.parse(args);
        if (validated.message_id) {
          await callTelegramApi(botToken, 'unpinChatMessage', {
            chat_id: validated.chat_id,
            message_id: validated.message_id,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Message ${validated.message_id} unpinned successfully`,
              },
            ],
          };
        } else {
          await callTelegramApi(botToken, 'unpinAllChatMessages', {
            chat_id: validated.chat_id,
          });
          return {
            content: [
              {
                type: 'text',
                text: `All messages unpinned successfully`,
              },
            ],
          };
        }
      }

      // Moderation
      case 'ban_chat_member': {
        const validated = BanChatMemberSchema.parse(args);
        await callTelegramApi(botToken, 'banChatMember', {
          chat_id: validated.chat_id,
          user_id: validated.user_id,
          until_date: validated.until_date,
        });

        return {
          content: [
            {
              type: 'text',
              text: `User ${validated.user_id} banned from chat`,
            },
          ],
        };
      }

      case 'unban_chat_member': {
        const validated = UnbanChatMemberSchema.parse(args);
        await callTelegramApi(botToken, 'unbanChatMember', {
          chat_id: validated.chat_id,
          user_id: validated.user_id,
          only_if_banned: validated.only_if_banned,
        });

        return {
          content: [
            {
              type: 'text',
              text: `User ${validated.user_id} unbanned from chat`,
            },
          ],
        };
      }

      // Bot info
      case 'get_me': {
        const result = await callTelegramApi(botToken, 'getMe');

        return {
          content: [
            {
              type: 'text',
              text: `Bot info:\nID: ${result.id}\nName: ${result.first_name}\nUsername: @${result.username}\nCan join groups: ${result.can_join_groups}\nCan read group messages: ${result.can_read_all_group_messages}\nSupports inline: ${result.supports_inline_queries}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.description || error.message;
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
