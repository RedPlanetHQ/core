import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { gmail_v1 } from 'googleapis';

// ========== SCHEMAS ==========
const DeleteDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to delete.'),
});

const CreateDraftsSchema = z.object({
  id: z.string().describe('The immutable ID of the draft.'),
  message: z.any().describe('The message content of the draft.'),
});

const GetDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to retrieve.'),
  format: z
    .enum(['minimal', 'full', 'raw', 'metadata'])
    .optional()
    .describe('The format to return the draft in.'),
});

const ListDraftsSchema = z.object({
  maxResults: z
    .number()
    .optional()
    .describe(
      'Maximum number of drafts to return. This field defaults to 100. The maximum allowed value for this field is 500.'
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
  includeSpamTrash: z
    .boolean()
    .optional()
    .describe('Include drafts from `SPAM` and `TRASH` in the results.'),
});

const SendDraftsSchema = z.object({
  id: z.string().describe('The immutable ID of the draft.'),
  message: z.any().describe('The message content of the draft.'),
});

const UpdateDraftsSchema = z.object({
  id: z.string().describe('The ID of the draft to update.'),
  message: z.any().describe('The message content of the draft.'),
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

const GetThreadsSchema = z.object({
  id: z.string().describe('The ID of the thread to retrieve.'),
  format: z
    .enum(['full', 'metadata', 'minimal'])
    .optional()
    .describe('The format to return the messages in.'),
  metadataHeaders: z
    .array(z.string())
    .optional()
    .describe('When given and format is METADATA, only include headers specified.'),
});

const ListThreadsSchema = z.object({
  maxResults: z
    .number()
    .optional()
    .describe(
      'Maximum number of threads to return. This field defaults to 100. The maximum allowed value for this field is 500.'
    ),
  pageToken: z
    .string()
    .optional()
    .describe('Page token to retrieve a specific page of results in the list.'),
  q: z
    .string()
    .optional()
    .describe(
      'Only return threads matching the specified query. Supports the same query format as the Gmail search box. For example, `"from:someuser@example.com rfc822msgid: is:unread"`. Parameter cannot be used when accessing the api using the gmail.metadata scope.'
    ),
  labelIds: z
    .array(z.string())
    .optional()
    .describe('Only return threads with labels that match all of the specified label IDs.'),
  includeSpamTrash: z
    .boolean()
    .optional()
    .describe('Include threads from `SPAM` and `TRASH` in the results.'),
});

const ModifyThreadsSchema = z.object({
  id: z.string().describe('The ID of the thread to modify.'),
  addLabelIds: z
    .array(z.string())
    .describe(
      'A list of IDs of labels to add to this thread. You can add up to 100 labels with each update.'
    ),
  removeLabelIds: z
    .array(z.string())
    .describe(
      'A list of IDs of labels to remove from this thread. You can remove up to 100 labels with each update.'
    ),
});

// ========== TOOL DEFINITIONS ==========
export const generatedTools = [
  {
    name: 'delete_draft',
    description:
      'Immediately and permanently deletes the specified draft. Does not simply trash it.',
    inputSchema: zodToJsonSchema(DeleteDraftsSchema),
  },
  {
    name: 'create_draft',
    description: 'Creates a new draft with the `DRAFT` label.',
    inputSchema: zodToJsonSchema(CreateDraftsSchema),
  },
  {
    name: 'get_draft',
    description: 'Gets the specified draft.',
    inputSchema: zodToJsonSchema(GetDraftsSchema),
  },
  {
    name: 'list_draft',
    description: "Lists the drafts in the user's mailbox.",
    inputSchema: zodToJsonSchema(ListDraftsSchema),
  },
  {
    name: 'send_draft',
    description:
      'Sends the specified, existing draft to the recipients in the `To`, `Cc`, and `Bcc` headers.',
    inputSchema: zodToJsonSchema(SendDraftsSchema),
  },
  {
    name: 'update_draft',
    description: "Replaces a draft's content.",
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
    name: 'get_thread',
    description: 'Gets the specified thread.',
    inputSchema: zodToJsonSchema(GetThreadsSchema),
  },
  {
    name: 'list_thread',
    description: "Lists the threads in the user's mailbox.",
    inputSchema: zodToJsonSchema(ListThreadsSchema),
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
      const response = await gmail.users.drafts.delete({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'create_draft': {
      const validatedArgs = CreateDraftsSchema.parse(args);
      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'get_draft': {
      const validatedArgs = GetDraftsSchema.parse(args);
      const response = await gmail.users.drafts.get({
        userId: 'me',
        id: validatedArgs.id,
        format: validatedArgs.format,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'list_draft': {
      const validatedArgs = ListDraftsSchema.parse(args);
      const response = await gmail.users.drafts.list({
        userId: 'me',
        maxResults: validatedArgs.maxResults,
        pageToken: validatedArgs.pageToken,
        q: validatedArgs.q,
        includeSpamTrash: validatedArgs.includeSpamTrash,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'send_draft': {
      const validatedArgs = SendDraftsSchema.parse(args);
      const response = await gmail.users.drafts.send({
        userId: 'me',
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'update_draft': {
      const validatedArgs = UpdateDraftsSchema.parse(args);
      const response = await gmail.users.drafts.update({
        userId: 'me',
        id: validatedArgs.id,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
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
            text: JSON.stringify(response.data, null, 2),
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
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'delete_thread': {
      const validatedArgs = DeleteThreadsSchema.parse(args);
      const response = await gmail.users.threads.delete({
        userId: 'me',
        id: validatedArgs.id,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    case 'get_thread': {
      const validatedArgs = GetThreadsSchema.parse(args);
      const response = await gmail.users.threads.get(
        {
          id: validatedArgs.id,
          format: validatedArgs.format,
          metadataHeaders: validatedArgs.metadataHeaders,
          userId: 'me',
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

    case 'list_thread': {
      const validatedArgs = ListThreadsSchema.parse(args);
      const response = await gmail.users.threads.list(
        {
          userId: 'me',
          maxResults: validatedArgs.maxResults,
          pageToken: validatedArgs.pageToken,
          q: validatedArgs.q,
          labelIds: validatedArgs.labelIds,
          includeSpamTrash: validatedArgs.includeSpamTrash,
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

    case 'modify_thread': {
      const validatedArgs = ModifyThreadsSchema.parse(args);
      const response = await gmail.users.threads.modify({
        userId: 'me',
        id: validatedArgs.id,
        requestBody: validatedArgs,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown generated tool: ${name}`);
  }
}

// ========== SUMMARY ==========
// Generated 13 new tools:
// - gmail.users.drafts.delete: Immediately and permanently deletes the specified draft. Does not simply trash i
// - gmail.users.drafts.create: Creates a new draft with the `DRAFT` label.
// - gmail.users.drafts.get: Gets the specified draft.
// - gmail.users.drafts.list: Lists the drafts in the user's mailbox.
// - gmail.users.drafts.send: Sends the specified, existing draft to the recipients in the `To`, `Cc`, and `Bc
// - gmail.users.drafts.update: Replaces a draft's content.
// - gmail.users.history.list: Lists the history of all changes to the given mailbox. History results are retur
// - gmail.users.threads.trash: Moves the specified thread to the trash. Any messages that belong to the thread
// - gmail.users.threads.untrash: Removes the specified thread from the trash. Any messages that belong to the thr
// - gmail.users.threads.delete: Immediately and permanently deletes the specified thread. Any messages that belo
// - gmail.users.threads.get: Gets the specified thread.
// - gmail.users.threads.list: Lists the threads in the user's mailbox.
// - gmail.users.threads.modify: Modifies the labels applied to the thread. This applies to all messages in the t
