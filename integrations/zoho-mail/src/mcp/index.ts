import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';
import { getAccountsZohoUrl, getMailZohoUrl } from '../region-config';

let zohoClient: AxiosInstance;

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  location?: string
): Promise<string> {
  const accountsZohoUrl = getAccountsZohoUrl(location);
  const response = await axios.post(`${accountsZohoUrl}/oauth/v2/token`, null, {
    params: {
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    },
  });
  return response.data.access_token;
}

async function initializeClient(
  clientId: string,
  clientSecret: string,
  config: Record<string, string>
) {
  let accessToken = config.access_token;
  const location = config.location;
  if (config.refresh_token) {
    try {
      accessToken = await refreshAccessToken(
        clientId,
        clientSecret,
        config.refresh_token,
        location
      );
    } catch (error) {
      console.error('Token refresh failed, using existing token');
    }
  }

  const mailZohoUrl = getMailZohoUrl(location);
  zohoClient = axios.create({
    baseURL: `${mailZohoUrl}/api`,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// Schemas
const schemas = {
  sendEmail: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    toAddress: z.string().describe('Recipient email address'),
    fromAddress: z.string().describe('Sender email address'),
    subject: z.string().describe('Email subject line'),
    content: z.string().describe('Email body content (HTML or plain text)'),
    ccAddress: z.string().optional().describe('CC recipients (comma-separated email addresses)'),
    bccAddress: z.string().optional().describe('BCC recipients (comma-separated email addresses)'),
  }),
  sendReply: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageId: z.string().describe('Original message ID to reply to'),
    content: z.string().describe('Reply message content'),
    replyTo: z.string().optional().describe('Reply-to email address'),
  }),
  getMessageContent: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageId: z.string().describe('Message ID to retrieve content for'),
  }),
  listEmails: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    folderId: z
      .string()
      .optional()
      .default('inbox')
      .describe('Folder ID to list emails from (default: inbox)'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of emails to retrieve (default: 20)'),
    start: z.number().optional().default(0).describe('Starting index for pagination (default: 0)'),
  }),
  searchEmails: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    searchKey: z.string().describe('Search query string to find emails'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of search results (default: 20)'),
  }),
  deleteEmail: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to delete'),
  }),
  moveMessages: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to move'),
    folderId: z.string().describe('Destination folder ID to move emails to'),
  }),
  readMessages: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to mark as read'),
  }),
  archiveMessage: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to archive'),
  }),
  spamMessage: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to mark as spam'),
  }),
  flagMessages: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageIds: z.array(z.string()).describe('Array of message IDs to flag'),
    flagStatus: z
      .enum(['info', 'important', 'follow-up', 'flag_not_set'])
      .describe('Flag type to apply to emails'),
  }),
  createFolder: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    folderName: z.string().describe('Name for the new folder'),
  }),
  getAllFolders: z.object({
    accountId: z.string().describe('Zoho Mail account ID to list folders for'),
  }),
  getAccounts: z.object({}),
  getAttachmentInfo: z.object({
    accountId: z.string().describe('Zoho Mail account ID'),
    messageId: z.string().describe('Message ID to get attachment information for'),
  }),
};

const data = {
  clientId: '1000.WB5B60VXRGYIVDDYLHFAZ07ICOJHQH',
  clientSecret: '23a4898b422c254958fa05b72be2df15db0a36be54',
};
export async function getTools() {
  const token = await refreshAccessToken(
    data.clientId,
    data.clientSecret,
    '1000.b4803dc72d53d131aaa75a5efddee434.93d28e9db10f18e3b1ebd9a47f6e6d5d',
    'eu'
  );

  return [
    {
      name: 'zoho_send_email',
      description: 'Send an email',
      inputSchema: zodToJsonSchema(schemas.sendEmail),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'zoho_send_reply',
      description: 'Send a reply to an email',
      inputSchema: zodToJsonSchema(schemas.sendReply),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'zoho_get_message',
      description: 'Get email content',
      inputSchema: zodToJsonSchema(schemas.getMessageContent),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'zoho_list_emails',
      description: 'List emails from folder',
      inputSchema: zodToJsonSchema(schemas.listEmails),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'zoho_search_emails',
      description: 'Search emails',
      inputSchema: zodToJsonSchema(schemas.searchEmails),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'zoho_delete_email',
      description: 'Delete emails',
      inputSchema: zodToJsonSchema(schemas.deleteEmail),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_move_messages',
      description: 'Move emails to folder',
      inputSchema: zodToJsonSchema(schemas.moveMessages),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_read_messages',
      description: 'Mark emails as read',
      inputSchema: zodToJsonSchema(schemas.readMessages),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_archive_message',
      description: 'Archive emails',
      inputSchema: zodToJsonSchema(schemas.archiveMessage),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_spam_message',
      description: 'Mark as spam',
      inputSchema: zodToJsonSchema(schemas.spamMessage),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_flag_messages',
      description: 'Flag emails',
      inputSchema: zodToJsonSchema(schemas.flagMessages),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'zoho_create_folder',
      description: 'Create a folder',
      inputSchema: zodToJsonSchema(schemas.createFolder),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'zoho_get_folders',
      description: 'List all folders',
      inputSchema: zodToJsonSchema(schemas.getAllFolders),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'zoho_get_accounts',
      description: 'Get all accounts',
      inputSchema: zodToJsonSchema(schemas.getAccounts),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'zoho_get_attachments',
      description: 'Get attachment info',
      inputSchema: zodToJsonSchema(schemas.getAttachmentInfo),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  clientId: string,
  clientSecret: string,
  config: Record<string, string>
) {
  await initializeClient(clientId, clientSecret, config);

  try {
    switch (name) {
      case 'zoho_send_email': {
        const { accountId, ...emailData } = schemas.sendEmail.parse(args);
        const res = await zohoClient.post(`/accounts/${accountId}/messages`, emailData);
        return {
          content: [{ type: 'text', text: `Email sent! ID: ${res.data.data?.messageId}` }],
        };
      }

      case 'zoho_send_reply': {
        const { accountId, messageId, content, replyTo } = schemas.sendReply.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/${messageId}/reply`, {
          content,
          replyTo,
        });
        return {
          content: [{ type: 'text', text: 'Reply sent successfully' }],
        };
      }

      case 'zoho_get_message': {
        const { accountId, messageId } = schemas.getMessageContent.parse(args);
        const res = await zohoClient.get(`/accounts/${accountId}/messages/${messageId}/content`);
        const email = res.data.data;
        return {
          content: [
            {
              type: 'text',
              text: `From: ${email.fromAddress}\nTo: ${email.toAddress}\nSubject: ${email.subject}\n\n${email.content}`,
            },
          ],
        };
      }

      case 'zoho_list_emails': {
        const { accountId, folderId, limit, start } = schemas.listEmails.parse(args);
        const res = await zohoClient.get(`/accounts/${accountId}/messages/view`, {
          params: { folderId, limit, start },
        });
        const emails = res.data.data || [];
        const list = emails
          .map((e: any) => `From: ${e.fromAddress}\nSubject: ${e.subject}\nID: ${e.messageId}`)
          .join('\n\n');
        return {
          content: [{ type: 'text', text: `Found ${emails.length} emails:\n\n${list}` }],
        };
      }

      case 'zoho_search_emails': {
        const { accountId, searchKey, limit } = schemas.searchEmails.parse(args);
        const res = await zohoClient.get(`/accounts/${accountId}/messages/search`, {
          params: { searchKey, limit },
        });
        const emails = res.data.data || [];
        const list = emails
          .map((e: any) => `From: ${e.fromAddress}\nSubject: ${e.subject}\nID: ${e.messageId}`)
          .join('\n\n');
        return {
          content: [{ type: 'text', text: `Found ${emails.length} results:\n\n${list}` }],
        };
      }

      case 'zoho_delete_email': {
        const { accountId, messageIds } = schemas.deleteEmail.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/delete`, { messageIds });
        return {
          content: [{ type: 'text', text: `Deleted ${messageIds.length} email(s)` }],
        };
      }

      case 'zoho_move_messages': {
        const { accountId, messageIds, folderId } = schemas.moveMessages.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/move`, {
          messageIds,
          folderId,
        });
        return {
          content: [{ type: 'text', text: `Moved ${messageIds.length} email(s)` }],
        };
      }

      case 'zoho_read_messages': {
        const { accountId, messageIds } = schemas.readMessages.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/read`, { messageIds });
        return {
          content: [{ type: 'text', text: `Marked ${messageIds.length} as read` }],
        };
      }

      case 'zoho_archive_message': {
        const { accountId, messageIds } = schemas.archiveMessage.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/archive`, { messageIds });
        return {
          content: [{ type: 'text', text: `Archived ${messageIds.length} email(s)` }],
        };
      }

      case 'zoho_spam_message': {
        const { accountId, messageIds } = schemas.spamMessage.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/spam`, { messageIds });
        return {
          content: [{ type: 'text', text: `Marked ${messageIds.length} as spam` }],
        };
      }

      case 'zoho_flag_messages': {
        const { accountId, messageIds, flagStatus } = schemas.flagMessages.parse(args);
        await zohoClient.post(`/accounts/${accountId}/messages/flag`, {
          messageIds,
          flagStatus,
        });
        return {
          content: [{ type: 'text', text: `Flagged ${messageIds.length} email(s)` }],
        };
      }

      case 'zoho_create_folder': {
        const { accountId, folderName } = schemas.createFolder.parse(args);
        const res = await zohoClient.post(`/accounts/${accountId}/folders`, { folderName });
        return {
          content: [{ type: 'text', text: `Folder created: ${res.data.data?.folderId}` }],
        };
      }

      case 'zoho_get_folders': {
        const { accountId } = schemas.getAllFolders.parse(args);
        const res = await zohoClient.get(`/accounts/${accountId}/folders`);
        const folders = res.data.data || [];
        const list = folders
          .map((f: any) => `${f.folderName} (ID: ${f.folderId}, Unread: ${f.unreadCount})`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `Folders:\n${list}` }],
        };
      }

      case 'zoho_get_accounts': {
        schemas.getAccounts.parse(args);
        const res = await zohoClient.get('/accounts');
        const accounts = res.data.data || [];
        const list = accounts
          .map((a: any) => `${a.displayName}\nEmail: ${a.primaryEmailAddress}\nID: ${a.accountId}`)
          .join('\n\n');
        return {
          content: [{ type: 'text', text: `Accounts:\n\n${list}` }],
        };
      }

      case 'zoho_get_attachments': {
        const { accountId, messageId } = schemas.getAttachmentInfo.parse(args);
        const res = await zohoClient.get(
          `/accounts/${accountId}/messages/${messageId}/attachmentinfo`
        );
        const attachments = res.data.data || [];
        const list = attachments
          .map((a: any) => `${a.attachmentName} (${a.size} bytes)`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `Attachments:\n${list}` }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.response?.data?.message || error.message}` }],
    };
  }
}
