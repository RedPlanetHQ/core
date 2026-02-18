import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { gmail_v1 } from 'googleapis';

import { createEmailMessage } from './util';

// ========== SCHEMAS ==========
const DeleteDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to delete.'),
});

const GetDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to retrieve.'),
});

const ListDraftsSchema = z.object({
  maxResults: z
    .number()
    .optional()
    .describe(
      'Maximum number of drafts to return. This field defaults to 10. The maximum allowed value for this field is 500.'
    ),
  pageToken: z
    .string()
    .optional()
    .describe('Page token to retrieve a specific page of results in the list.'),
  q: z
    .string()
    .optional()
    .describe(
      'Only return draft messages matching the specified query. Supports the same query format as the Gmail search box. For example, `"from:someuser@example.com rfc822msgid: is:unread"`.'
    ),
});

const SendDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to send.'),
});

const UpdateDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to update.'),
  to: z.array(z.string()).optional().describe('List of recipient email addresses'),
  subject: z.string().optional().describe('Email subject'),
  body: z.string().optional().describe('Email body content (plain text)'),
  htmlBody: z.string().optional().describe('HTML version of the email body'),
  mimeType: z
    .enum(['text/plain', 'text/html', 'multipart/alternative'])
    .optional()
    .describe('Email content type'),
  cc: z.array(z.string()).optional().describe('List of CC recipients'),
  bcc: z.array(z.string()).optional().describe('List of BCC recipients'),
});

const ListHistorySchema = z.object({
  maxResults: z
    .number()
    .optional()
    .describe(
      'Maximum number of history records to return. This field defaults to 100. The maximum allowed value for this field is 500.'
    ),
  pageToken: z
    .string()
    .optional()
    .describe('Page token to retrieve a specific page of results in the list.'),
  startHistoryId: z
    .string()
    .optional()
    .describe(
      'Required. Returns history records after the specified `startHistoryId`. The supplied `startHistoryId` should be obtained from the `historyId` of a message, thread, or previous `list` response. History IDs increase chronologically but are not contiguous with random gaps in between valid IDs. Supplying an invalid or out of date `startHistoryId` typically returns an `HTTP 404` error code. A `historyId` is typically valid for at least a week, but in some rare circumstances may be valid for only a few hours. If you receive an `HTTP 404` error response, your application should perform a full sync. If you receive no `nextPageToken` in the response, there are no updates to retrieve and you can store the returned `historyId` for a future request.'
    ),
  labelId: z.string().optional().describe('Only return messages with a label matching the ID.'),
  historyTypes: z
    .array(z.enum(['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']))
    .optional()
    .describe('History types to be returned by the function'),
});

const TrashThreadsSchema = z.object({
  id: z.string().describe('The ID of the thread to Trash.'),
});

const UntrashThreadsSchema = z.object({
  id: z.string().describe('The ID of the thread to remove from Trash.'),
});

const DeleteThreadsSchema = z.object({
  id: z.string().describe('ID of the Thread to delete.'),
});

const ModifyThreadsSchema = z.object({
  id: z.string().describe('The ID of the thread to modify.'),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe(
      'A list of IDs of labels to add to this thread. You can add up to 100 labels with each update.'
    ),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe(
      'A list of IDs of labels to remove from this thread. You can remove up to 100 labels with each update.'
    ),
});

// ========== HELPER FUNCTIONS ==========

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

/**
 * Recursively extracts text and HTML content from Gmail message parts
 */
function extractEmailContent(part: GmailMessagePart): { text: string; html: string } {
  let text = '';
  let html = '';

  if (part.mimeType === 'text/plain' && part.body?.data) {
    text = Buffer.from(part.body.data, 'base64').toString('utf-8');
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    html = Buffer.from(part.body.data, 'base64').toString('utf-8');
  }

  if (part.parts) {
    for (const subPart of part.parts) {
      const subContent = extractEmailContent(subPart);
      if (subContent.text) text = subContent.text;
      if (subContent.html) html = subContent.html;
    }
  }

  return { text, html };
}

/**
 * Format a draft message into readable output
 */
function formatDraftOutput(draft: gmail_v1.Schema$Draft): string {
  const message = draft.message;
  if (!message) {
    return `Draft ID: ${draft.id}\nNo message content available`;
  }

  const headers = message.payload?.headers || [];
  const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
  const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
  const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
  const cc = headers.find(h => h.name?.toLowerCase() === 'cc')?.value || '';
  const bcc = headers.find(h => h.name?.toLowerCase() === 'bcc')?.value || '';
  const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';
  const snippet = message.snippet || '';

  const parts = [
    `Draft ID: ${draft.id}`,
    `Message ID: ${message.id || ''}`,
    `Thread ID: ${message.threadId || ''}`,
    `Subject: ${subject}`,
    `From: ${from}`,
    `To: ${to}`,
  ];

  if (cc) parts.push(`Cc: ${cc}`);
  if (bcc) parts.push(`Bcc: ${bcc}`);
  if (date) parts.push(`Date: ${date}`);
  parts.push(`Snippet: ${snippet}`);

  return parts.join('\n');
}

// ========== TOOL DEFINITIONS ==========
export const generatedTools = [
  {
    name: 'delete_draft',
    description:
      'Immediately and permanently deletes the specified draft. Does not simply trash it.',
    inputSchema: zodToJsonSchema(DeleteDraftsSchema),
  },
  {
    name: 'get_draft',
    description:
      'Gets the specified draft with full content including subject, recipients, and body.',
    inputSchema: zodToJsonSchema(GetDraftsSchema),
  },
  {
    name: 'list_draft',
    description:
      "Lists the drafts in the user's mailbox with subject, recipients, and snippet for each draft.",
    inputSchema: zodToJsonSchema(ListDraftsSchema),
  },
  {
    name: 'send_draft',
    description: 'Sends the specified existing draft to the recipients already set in the draft.',
    inputSchema: zodToJsonSchema(SendDraftsSchema),
  },
  {
    name: 'update_draft',
    description:
      "Updates a draft's content including recipients, subject, and body. All fields are optional - only provided fields will be updated.",
    inputSchema: zodToJsonSchema(UpdateDraftsSchema),
  },
  {
    name: 'list_history',
    description:
      'Lists the history of all changes to the given mailbox. History results are returned in chronological order (increasing `historyId`).',
    inputSchema: zodToJsonSchema(ListHistorySchema),
  },
  {
    name: 'trash_thread',
    description:
      'Moves the specified thread to the trash. Any messages that belong to the thread are also moved to the trash.',
    inputSchema: zodToJsonSchema(TrashThreadsSchema),
  },
  {
    name: 'untrash_thread',
    description:
      'Removes the specified thread from the trash. Any messages that belong to the thread are also removed from the trash.',
    inputSchema: zodToJsonSchema(UntrashThreadsSchema),
  },
  {
    name: 'delete_thread',
    description:
      'Immediately and permanently deletes the specified thread. Any messages that belong to the thread are also deleted. This operation cannot be undone. Prefer `threads.trash` instead.',
    inputSchema: zodToJsonSchema(DeleteThreadsSchema),
  },
  {
    name: 'modify_thread',
    description:
      'Modifies the labels applied to the thread. This applies to all messages in the thread.',
    inputSchema: zodToJsonSchema(ModifyThreadsSchema),
  },
];

// ========== HANDLER FUNCTION ==========
/**
 * Handles auto-generated tool calls
 * @param name - Tool name
 * @param args - Tool arguments
 * @param gmail - Gmail API client
 */
export async function handleGeneratedTool(
  name: string,
  args: any,
  gmail: gmail_v1.Gmail
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'delete_draft': {
      const validatedArgs = DeleteDraftsSchema.parse(args);
      await gmail.users.drafts.delete({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Draft ${validatedArgs.id} deleted successfully.`,
          },
        ],
      };
    }

    case 'get_draft': {
      const validatedArgs = GetDraftsSchema.parse(args);
      const response = await gmail.users.drafts.get({
        userId: 'me',
        id: validatedArgs.id,
        format: 'full',
      });

      const draft = response.data;
      const message = draft.message;

      if (!message?.payload) {
        return {
          content: [
            {
              type: 'text',
              text: formatDraftOutput(draft),
            },
          ],
        };
      }

      const headers = message.payload.headers || [];
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
      const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
      const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
      const cc = headers.find(h => h.name?.toLowerCase() === 'cc')?.value || '';
      const bcc = headers.find(h => h.name?.toLowerCase() === 'bcc')?.value || '';
      const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';

      // Extract body content
      const { text, html } = extractEmailContent(message.payload as GmailMessagePart);
      const body = text || html || '';
      const contentTypeNote =
        !text && html
          ? '[Note: This email is HTML-formatted. Plain text version not available.]\n\n'
          : '';

      const parts = [
        `Draft ID: ${draft.id}`,
        `Message ID: ${message.id || ''}`,
        `Thread ID: ${message.threadId || ''}`,
        `Subject: ${subject}`,
        `From: ${from}`,
        `To: ${to}`,
      ];

      if (cc) parts.push(`Cc: ${cc}`);
      if (bcc) parts.push(`Bcc: ${bcc}`);
      if (date) parts.push(`Date: ${date}`);
      parts.push('');
      parts.push(contentTypeNote + body);

      return {
        content: [
          {
            type: 'text',
            text: parts.join('\n'),
          },
        ],
      };
    }

    case 'list_draft': {
      const validatedArgs = ListDraftsSchema.parse(args);
      const response = await gmail.users.drafts.list({
        userId: 'me',
        maxResults: validatedArgs.maxResults || 10,
        pageToken: validatedArgs.pageToken,
        q: validatedArgs.q,
      });

      const drafts = response.data.drafts || [];

      if (drafts.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No drafts found.',
            },
          ],
        };
      }

      // Fetch full details for each draft
      const results = await Promise.all(
        drafts.map(async draft => {
          const detail = await gmail.users.drafts.get({
            userId: 'me',
            id: draft.id as string,
            format: 'full',
          });

          const message = detail.data.message;
          const headers = message?.payload?.headers || [];
          const snippet = message?.snippet || '';

          return {
            id: draft.id,
            messageId: message?.id || '',
            threadId: message?.threadId || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            from: headers.find(h => h.name === 'From')?.value || '',
            to: headers.find(h => h.name === 'To')?.value || '',
            cc: headers.find(h => h.name === 'Cc')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            snippet,
          };
        })
      );

      const output = results
        .map(
          r =>
            `Draft ID: ${r.id}\nMessage ID: ${r.messageId}\nThread ID: ${r.threadId}\nSubject: ${r.subject}\nFrom: ${r.from}\nTo: ${r.to}${r.cc ? `\nCc: ${r.cc}` : ''}\nDate: ${r.date}\nSnippet: ${r.snippet}\n`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
      };
    }

    case 'send_draft': {
      const validatedArgs = SendDraftsSchema.parse(args);
      const response = await gmail.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: validatedArgs.id,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Draft sent successfully. Message ID: ${response.data.id}`,
          },
        ],
      };
    }

    case 'update_draft': {
      const validatedArgs = UpdateDraftsSchema.parse(args);

      // First, get the existing draft to preserve unchanged fields
      const existingDraft = await gmail.users.drafts.get({
        userId: 'me',
        id: validatedArgs.id,
        format: 'full',
      });

      const existingMessage = existingDraft.data.message;
      const existingHeaders = existingMessage?.payload?.headers || [];

      // Extract existing values
      const existingTo = existingHeaders.find(h => h.name?.toLowerCase() === 'to')?.value || '';
      const existingCc = existingHeaders.find(h => h.name?.toLowerCase() === 'cc')?.value || '';
      const existingBcc = existingHeaders.find(h => h.name?.toLowerCase() === 'bcc')?.value || '';
      const existingSubject =
        existingHeaders.find(h => h.name?.toLowerCase() === 'subject')?.value || '';

      // Extract existing body
      const { text: existingText, html: existingHtml } = extractEmailContent(
        (existingMessage?.payload as GmailMessagePart) || {}
      );

      // Merge with new values (new values override existing)
      const to =
        validatedArgs.to ||
        existingTo
          .split(',')
          .map(e => e.trim())
          .filter(Boolean);
      const cc =
        validatedArgs.cc ||
        (existingCc
          ? existingCc
              .split(',')
              .map(e => e.trim())
              .filter(Boolean)
          : undefined);
      const bcc =
        validatedArgs.bcc ||
        (existingBcc
          ? existingBcc
              .split(',')
              .map(e => e.trim())
              .filter(Boolean)
          : undefined);
      const subject = validatedArgs.subject ?? existingSubject;
      const body = validatedArgs.body ?? existingText ?? '';
      const htmlBody = validatedArgs.htmlBody ?? existingHtml;
      const mimeType = validatedArgs.mimeType;

      // Create the email message
      const emailArgs = {
        to: Array.isArray(to) ? to : [to],
        cc,
        bcc,
        subject,
        body,
        htmlBody,
        mimeType,
      };

      const message = createEmailMessage(emailArgs);
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.drafts.update({
        userId: 'me',
        id: validatedArgs.id,
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: existingMessage?.threadId,
          },
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Draft updated successfully. Draft ID: ${response.data.id}`,
          },
        ],
      };
    }

    case 'list_history': {
      const validatedArgs = ListHistorySchema.parse(args);
      const response = await gmail.users.history.list(
        {
          userId: 'me',
          maxResults: validatedArgs.maxResults,
          pageToken: validatedArgs.pageToken,
          startHistoryId: validatedArgs.startHistoryId,
          labelId: validatedArgs.labelId,
          historyTypes: validatedArgs.historyTypes,
        },
        {}
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'trash_thread': {
      const validatedArgs = TrashThreadsSchema.parse(args);
      const response = await gmail.users.threads.trash({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Thread ${validatedArgs.id} moved to trash.`,
          },
        ],
      };
    }

    case 'untrash_thread': {
      const validatedArgs = UntrashThreadsSchema.parse(args);
      const response = await gmail.users.threads.untrash({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Thread ${validatedArgs.id} removed from trash.`,
          },
        ],
      };
    }

    case 'delete_thread': {
      const validatedArgs = DeleteThreadsSchema.parse(args);
      await gmail.users.threads.delete({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Thread ${validatedArgs.id} permanently deleted.`,
          },
        ],
      };
    }

    case 'modify_thread': {
      const validatedArgs = ModifyThreadsSchema.parse(args);
      const response = await gmail.users.threads.modify({
        userId: 'me',
        id: validatedArgs.id,
        requestBody: {
          addLabelIds: validatedArgs.addLabelIds,
          removeLabelIds: validatedArgs.removeLabelIds,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Thread ${validatedArgs.id} labels modified successfully.`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown generated tool: ${name}`);
  }
}
