/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ────────────────────────────────────────────────────────────────

// Core Card CRUD

const GetCardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the Trello card'),
});

const CreateCardSchema = z.object({
  idList: z.string().describe('The ID of the list to create the card in (required)'),
  name: z.string().describe('The name/title of the card (required)'),
  desc: z.string().optional().describe('Description for the card (supports Markdown)'),
  due: z.string().optional().describe('Due date in ISO 8601 format, e.g. 2024-12-31T23:59:00.000Z'),
  dueComplete: z.boolean().optional().describe('Whether the due date has been marked complete'),
  idLabels: z.array(z.string()).optional().describe('Array of label IDs to attach to the card'),
  idMembers: z.array(z.string()).optional().describe('Array of member IDs to assign to the card'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('Position of the card in the list: "top", "bottom", or a positive float'),
  urlSource: z.string().url().optional().describe('A URL to attach to the card as a source link'),
});

const UpdateCardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card to update'),
  name: z.string().optional().describe('New name/title for the card'),
  desc: z.string().optional().describe('New description for the card'),
  due: z.string().nullable().optional().describe('New due date in ISO 8601 format, or null to remove'),
  dueComplete: z.boolean().optional().describe('Mark the due date as complete or incomplete'),
  closed: z.boolean().optional().describe('Archive (true) or unarchive (false) the card'),
  idList: z.string().optional().describe('Move the card to this list ID'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('New position in the list: "top", "bottom", or a positive float'),
  subscribed: z.boolean().optional().describe('Whether the current member is subscribed to the card'),
  idBoard: z.string().optional().describe('Move the card to this board ID'),
});

const DeleteCardSchema = z.object({
  card_id: z.string().describe('The ID of the card to permanently delete'),
});

// Card Actions/Comments

const GetCardActionsSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  filter: z
    .string()
    .optional()
    .default('commentCard,updateCard,createCard')
    .describe('Comma-separated action types to filter by (default: commentCard,updateCard,createCard)'),
});

const AddCardCommentSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card to comment on'),
  text: z.string().describe('The text of the comment to add'),
});

const UpdateCardCommentSchema = z.object({
  action_id: z.string().describe('The ID of the comment action to update'),
  text: z.string().describe('The new text for the comment'),
});

const DeleteCardCommentSchema = z.object({
  action_id: z.string().describe('The ID of the comment action to delete'),
});

// Card Attachments

const GetCardAttachmentsSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  filter: z
    .enum(['false', 'cover'])
    .optional()
    .describe('Filter attachments: "cover" returns only the cover attachment, "false" returns all'),
});

const AddCardAttachmentSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  url: z.string().optional().describe('URL of the attachment to add'),
  name: z.string().optional().describe('Name for the attachment'),
  mimeType: z.string().optional().describe('MIME type of the attachment, e.g. image/png'),
  setCover: z.boolean().optional().default(false).describe('Set this attachment as the card cover (default: false)'),
});

const GetCardAttachmentSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  attachment_id: z.string().describe('The ID of the attachment to retrieve'),
});

const DeleteCardAttachmentSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  attachment_id: z.string().describe('The ID of the attachment to delete'),
});

// Card Navigation

const GetCardBoardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const GetCardListSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

// Card Checklists

const GetCardChecklistsSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const AddChecklistToCardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card to add a checklist to'),
  name: z.string().optional().describe('Name for the new checklist'),
  idChecklistSource: z
    .string()
    .optional()
    .describe('ID of an existing checklist to copy items from'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('Position of the checklist on the card: "top", "bottom", or a positive float'),
});

const GetCardChecklistItemStatesSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const UpdateCardChecklistItemSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  checklist_id: z.string().describe('The ID of the checklist containing the item'),
  checkitem_id: z.string().describe('The ID of the checklist item to update'),
  state: z
    .enum(['complete', 'incomplete'])
    .optional()
    .describe('New state of the checklist item: "complete" or "incomplete"'),
  name: z.string().optional().describe('New name for the checklist item'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('New position of the item in the checklist: "top", "bottom", or a positive float'),
});

// Card Members

const GetCardMembersSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const AddCardMemberSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  member_id: z.string().describe('The ID of the member to add to the card'),
});

const RemoveCardMemberSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  member_id: z.string().describe('The ID of the member to remove from the card'),
});

// Card Votes

const GetCardVotesSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const AddCardVoteSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card to vote on'),
  member_id: z.string().describe('The ID of the member casting the vote'),
});

const RemoveCardVoteSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  member_id: z.string().describe('The ID of the member whose vote should be removed'),
});

// Card Labels

const AddLabelToCardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  label_id: z.string().describe('The ID of the label to add to the card'),
});

const RemoveLabelFromCardSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  label_id: z.string().describe('The ID of the label to remove from the card'),
});

// Card Stickers

const GetCardStickersSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

const AddCardStickerSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  image: z
    .string()
    .describe(
      'Name of the sticker image to use, e.g. "thumbsup", "heart", "check", "warning", "clock", "smile", "laugh", "huh", "frown", "thumbsdown", "star", "rocketship"',
    ),
  top: z.number().describe('Top position of the sticker as a percentage (0-100)'),
  left: z.number().describe('Left position of the sticker as a percentage (0-100)'),
  zIndex: z.number().describe('Z-index (stacking order) of the sticker'),
  rotate: z.number().optional().default(0).describe('Rotation angle in degrees (default: 0)'),
});

const GetCardStickerSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  sticker_id: z.string().describe('The ID of the sticker to retrieve'),
});

const UpdateCardStickerSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  sticker_id: z.string().describe('The ID of the sticker to update'),
  top: z.number().optional().describe('New top position as a percentage (0-100)'),
  left: z.number().optional().describe('New left position as a percentage (0-100)'),
  zIndex: z.number().optional().describe('New z-index (stacking order)'),
  rotate: z.number().optional().describe('New rotation angle in degrees'),
});

const DeleteCardStickerSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
  sticker_id: z.string().describe('The ID of the sticker to delete'),
});

// Card Custom Fields

const GetCardCustomFieldItemsSchema = z.object({
  card_id: z.string().describe('The ID or short link of the card'),
});

// ─── Tool Definitions ────────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    // Core Card CRUD
    {
      name: 'trello_get_card',
      description: 'Get full details of a Trello card including labels and members.',
      inputSchema: zodToJsonSchema(GetCardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_card',
      description: 'Create a new card in a Trello list with optional description, due date, labels, and members.',
      inputSchema: zodToJsonSchema(CreateCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_card',
      description: 'Update fields on an existing Trello card such as name, description, due date, list, or archive status.',
      inputSchema: zodToJsonSchema(UpdateCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_card',
      description: 'Permanently delete a Trello card. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Card Actions/Comments
    {
      name: 'trello_get_card_actions',
      description: 'Get the action history (comments, updates, etc.) for a Trello card.',
      inputSchema: zodToJsonSchema(GetCardActionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_card_comment',
      description: 'Add a comment to a Trello card.',
      inputSchema: zodToJsonSchema(AddCardCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_card_comment',
      description: 'Update the text of an existing comment on a Trello card.',
      inputSchema: zodToJsonSchema(UpdateCardCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_card_comment',
      description: 'Delete a comment from a Trello card.',
      inputSchema: zodToJsonSchema(DeleteCardCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Card Attachments
    {
      name: 'trello_get_card_attachments',
      description: 'List all attachments on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardAttachmentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_card_attachment',
      description: 'Add a URL attachment to a Trello card, optionally setting it as the card cover.',
      inputSchema: zodToJsonSchema(AddCardAttachmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_card_attachment',
      description: 'Get details of a specific attachment on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardAttachmentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_card_attachment',
      description: 'Delete an attachment from a Trello card.',
      inputSchema: zodToJsonSchema(DeleteCardAttachmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Card Navigation
    {
      name: 'trello_get_card_board',
      description: 'Get the board that a Trello card belongs to.',
      inputSchema: zodToJsonSchema(GetCardBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_card_list',
      description: 'Get the list that a Trello card currently belongs to.',
      inputSchema: zodToJsonSchema(GetCardListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Card Checklists
    {
      name: 'trello_get_card_checklists',
      description: 'Get all checklists on a Trello card including their items and completion states.',
      inputSchema: zodToJsonSchema(GetCardChecklistsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_checklist_to_card',
      description: 'Add a new checklist to a Trello card, optionally copied from an existing checklist.',
      inputSchema: zodToJsonSchema(AddChecklistToCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_card_checklist_item_states',
      description: 'Get the completion state of all checklist items across all checklists on a card.',
      inputSchema: zodToJsonSchema(GetCardChecklistItemStatesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_card_checklist_item',
      description: 'Update the state, name, or position of a checklist item on a Trello card.',
      inputSchema: zodToJsonSchema(UpdateCardChecklistItemSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Card Members
    {
      name: 'trello_get_card_members',
      description: 'Get the list of members assigned to a Trello card.',
      inputSchema: zodToJsonSchema(GetCardMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_card_member',
      description: 'Assign a member to a Trello card.',
      inputSchema: zodToJsonSchema(AddCardMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_remove_card_member',
      description: 'Remove a member from a Trello card.',
      inputSchema: zodToJsonSchema(RemoveCardMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Card Votes
    {
      name: 'trello_get_card_votes',
      description: 'Get the list of members who have voted on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardVotesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_card_vote',
      description: 'Add a vote on a Trello card for a specific member.',
      inputSchema: zodToJsonSchema(AddCardVoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_remove_card_vote',
      description: 'Remove a vote from a Trello card for a specific member.',
      inputSchema: zodToJsonSchema(RemoveCardVoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Card Labels
    {
      name: 'trello_add_label_to_card',
      description: 'Add a label to a Trello card.',
      inputSchema: zodToJsonSchema(AddLabelToCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_remove_label_from_card',
      description: 'Remove a label from a Trello card.',
      inputSchema: zodToJsonSchema(RemoveLabelFromCardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Card Stickers
    {
      name: 'trello_get_card_stickers',
      description: 'Get all stickers placed on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardStickersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_card_sticker',
      description: 'Add a sticker to a Trello card at a specific position.',
      inputSchema: zodToJsonSchema(AddCardStickerSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_card_sticker',
      description: 'Get details of a specific sticker on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardStickerSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_card_sticker',
      description: 'Update the position, z-index, or rotation of a sticker on a Trello card.',
      inputSchema: zodToJsonSchema(UpdateCardStickerSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_card_sticker',
      description: 'Delete a sticker from a Trello card.',
      inputSchema: zodToJsonSchema(DeleteCardStickerSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // Card Custom Fields
    {
      name: 'trello_get_card_custom_field_items',
      description: 'Get all custom field values set on a Trello card.',
      inputSchema: zodToJsonSchema(GetCardCustomFieldItemsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance,
): Promise<any> {
  try {
    switch (name) {
      // ── Core Card CRUD ──────────────────────────────────────────────────

      case 'trello_get_card': {
        const { card_id } = GetCardSchema.parse(args);
        const response = await client.get(`/cards/${card_id}`);
        const card = response.data;

        const labels = (card.labels || [])
          .map((l: any) => `${l.name || 'unnamed'} (${l.color})`)
          .join(', ') || 'None';
        const members = (card.members || [])
          .map((m: any) => m.fullName || m.username)
          .join(', ') || 'None';

        return {
          content: [
            {
              type: 'text',
              text: [
                `ID: ${card.id}`,
                `Name: ${card.name}`,
                `Description: ${card.desc || 'N/A'}`,
                `List ID: ${card.idList}`,
                `Board ID: ${card.idBoard}`,
                `Due: ${card.due || 'N/A'}`,
                `Due Complete: ${card.dueComplete}`,
                `Archived: ${card.closed}`,
                `URL: ${card.url}`,
                `Labels: ${labels}`,
                `Members: ${members}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_create_card': {
        const { idList, name, desc, due, dueComplete, idLabels, idMembers, pos, urlSource } =
          CreateCardSchema.parse(args);

        const body: Record<string, any> = { idList, name };
        if (desc !== undefined) body.desc = desc;
        if (due !== undefined) body.due = due;
        if (dueComplete !== undefined) body.dueComplete = dueComplete;
        if (idLabels?.length) body.idLabels = idLabels.join(',');
        if (idMembers?.length) body.idMembers = idMembers.join(',');
        if (pos !== undefined) body.pos = pos;
        if (urlSource !== undefined) body.urlSource = urlSource;

        const response = await client.post('/cards', body);
        const card = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Card created successfully.`,
                `ID: ${card.id}`,
                `Name: ${card.name}`,
                `URL: ${card.url}`,
                `List ID: ${card.idList}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_update_card': {
        const { card_id, name, desc, due, dueComplete, closed, idList, pos, subscribed, idBoard } =
          UpdateCardSchema.parse(args);

        const body: Record<string, any> = {};
        if (name !== undefined) body.name = name;
        if (desc !== undefined) body.desc = desc;
        if (due !== undefined) body.due = due;
        if (dueComplete !== undefined) body.dueComplete = dueComplete;
        if (closed !== undefined) body.closed = closed;
        if (idList !== undefined) body.idList = idList;
        if (pos !== undefined) body.pos = pos;
        if (subscribed !== undefined) body.subscribed = subscribed;
        if (idBoard !== undefined) body.idBoard = idBoard;

        await client.put(`/cards/${card_id}`, body);

        return {
          content: [{ type: 'text', text: `Card ${card_id} updated successfully.` }],
        };
      }

      case 'trello_delete_card': {
        const { card_id } = DeleteCardSchema.parse(args);
        await client.delete(`/cards/${card_id}`);

        return {
          content: [{ type: 'text', text: `Card ${card_id} deleted successfully.` }],
        };
      }

      // ── Card Actions/Comments ───────────────────────────────────────────

      case 'trello_get_card_actions': {
        const { card_id, filter } = GetCardActionsSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/actions`, {
          params: { filter },
        });
        const actions: any[] = response.data || [];

        if (actions.length === 0) {
          return { content: [{ type: 'text', text: 'No actions found for this card.' }] };
        }

        const list = actions
          .map((a: any) => {
            const actor = a.memberCreator?.fullName || a.memberCreator?.username || 'Unknown';
            const date = a.date ? new Date(a.date).toISOString() : 'N/A';
            const text = a.data?.text || JSON.stringify(a.data || {});
            return `ID: ${a.id}\nType: ${a.type}\nActor: ${actor}\nDate: ${date}\nData: ${text}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${actions.length} action(s):\n\n${list}` }],
        };
      }

      case 'trello_add_card_comment': {
        const { card_id, text } = AddCardCommentSchema.parse(args);
        const response = await client.post(`/cards/${card_id}/actions/comments`, { text });
        const action = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Comment added successfully.`,
                `ID: ${action.id}`,
                `Text: ${action.data?.text || text}`,
                `Author: ${action.memberCreator?.fullName || action.memberCreator?.username || 'Unknown'}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_update_card_comment': {
        const { action_id, text } = UpdateCardCommentSchema.parse(args);
        await client.put(`/actions/${action_id}`, { text });

        return {
          content: [{ type: 'text', text: `Comment ${action_id} updated successfully.` }],
        };
      }

      case 'trello_delete_card_comment': {
        const { action_id } = DeleteCardCommentSchema.parse(args);
        await client.delete(`/actions/${action_id}`);

        return {
          content: [{ type: 'text', text: `Comment ${action_id} deleted successfully.` }],
        };
      }

      // ── Card Attachments ────────────────────────────────────────────────

      case 'trello_get_card_attachments': {
        const { card_id, filter } = GetCardAttachmentsSchema.parse(args);
        const params: Record<string, any> = {};
        if (filter !== undefined) params.filter = filter;

        const response = await client.get(`/cards/${card_id}/attachments`, { params });
        const attachments: any[] = response.data || [];

        if (attachments.length === 0) {
          return { content: [{ type: 'text', text: 'No attachments found on this card.' }] };
        }

        const list = attachments
          .map((a: any) =>
            [
              `ID: ${a.id}`,
              `Name: ${a.name || 'N/A'}`,
              `URL: ${a.url || 'N/A'}`,
              `MIME Type: ${a.mimeType || 'N/A'}`,
              `Bytes: ${a.bytes !== null && a.bytes !== undefined ? a.bytes : 'N/A'}`,
            ].join('\n'),
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${attachments.length} attachment(s):\n\n${list}` }],
        };
      }

      case 'trello_add_card_attachment': {
        const { card_id, url, name, mimeType, setCover } = AddCardAttachmentSchema.parse(args);

        const body: Record<string, any> = {};
        if (url !== undefined) body.url = url;
        if (name !== undefined) body.name = name;
        if (mimeType !== undefined) body.mimeType = mimeType;
        if (setCover !== undefined) body.setCover = setCover;

        const response = await client.post(`/cards/${card_id}/attachments`, body);
        const attachment = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Attachment added successfully.`,
                `ID: ${attachment.id}`,
                `Name: ${attachment.name || 'N/A'}`,
                `URL: ${attachment.url || 'N/A'}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_get_card_attachment': {
        const { card_id, attachment_id } = GetCardAttachmentSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/attachments/${attachment_id}`);
        const a = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `ID: ${a.id}`,
                `Name: ${a.name || 'N/A'}`,
                `URL: ${a.url || 'N/A'}`,
                `MIME Type: ${a.mimeType || 'N/A'}`,
                `Bytes: ${a.bytes !== null && a.bytes !== undefined ? a.bytes : 'N/A'}`,
                `Is Cover: ${a.isCover || false}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_delete_card_attachment': {
        const { card_id, attachment_id } = DeleteCardAttachmentSchema.parse(args);
        await client.delete(`/cards/${card_id}/attachments/${attachment_id}`);

        return {
          content: [{ type: 'text', text: `Attachment ${attachment_id} deleted successfully.` }],
        };
      }

      // ── Card Navigation ─────────────────────────────────────────────────

      case 'trello_get_card_board': {
        const { card_id } = GetCardBoardSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/board`);
        const board = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [`ID: ${board.id}`, `Name: ${board.name}`, `URL: ${board.url}`].join('\n'),
            },
          ],
        };
      }

      case 'trello_get_card_list': {
        const { card_id } = GetCardListSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/list`);
        const list = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [`ID: ${list.id}`, `Name: ${list.name}`].join('\n'),
            },
          ],
        };
      }

      // ── Card Checklists ─────────────────────────────────────────────────

      case 'trello_get_card_checklists': {
        const { card_id } = GetCardChecklistsSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/checklists`);
        const checklists: any[] = response.data || [];

        if (checklists.length === 0) {
          return { content: [{ type: 'text', text: 'No checklists found on this card.' }] };
        }

        const list = checklists
          .map((cl: any) => {
            const items = (cl.checkItems || [])
              .map((item: any) => `  [${item.state === 'complete' ? 'x' : ' '}] ${item.name} (ID: ${item.id})`)
              .join('\n');
            return `ID: ${cl.id}\nName: ${cl.name}\nItems:\n${items || '  (none)'}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${checklists.length} checklist(s):\n\n${list}` }],
        };
      }

      case 'trello_add_checklist_to_card': {
        const { card_id, name, idChecklistSource, pos } = AddChecklistToCardSchema.parse(args);

        const body: Record<string, any> = {};
        if (name !== undefined) body.name = name;
        if (idChecklistSource !== undefined) body.idChecklistSource = idChecklistSource;
        if (pos !== undefined) body.pos = pos;

        const response = await client.post(`/cards/${card_id}/checklists`, body);
        const checklist = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Checklist added successfully.`,
                `ID: ${checklist.id}`,
                `Name: ${checklist.name}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_get_card_checklist_item_states': {
        const { card_id } = GetCardChecklistItemStatesSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/checkItemStates`);
        const states: any[] = response.data || [];

        if (states.length === 0) {
          return { content: [{ type: 'text', text: 'No checklist item states found.' }] };
        }

        const list = states
          .map((s: any) => `Checklist Item ID: ${s.idCheckItem}\nState: ${s.state}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${states.length} item state(s):\n\n${list}` }],
        };
      }

      case 'trello_update_card_checklist_item': {
        const { card_id, checklist_id, checkitem_id, state, name, pos } =
          UpdateCardChecklistItemSchema.parse(args);

        const body: Record<string, any> = {};
        if (state !== undefined) body.state = state;
        if (name !== undefined) body.name = name;
        if (pos !== undefined) body.pos = pos;

        const response = await client.put(
          `/cards/${card_id}/checklist/${checklist_id}/checkItem/${checkitem_id}`,
          body,
        );
        const item = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Checklist item updated successfully.`,
                `ID: ${item.id}`,
                `Name: ${item.name}`,
                `State: ${item.state}`,
              ].join('\n'),
            },
          ],
        };
      }

      // ── Card Members ────────────────────────────────────────────────────

      case 'trello_get_card_members': {
        const { card_id } = GetCardMembersSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/members`);
        const members: any[] = response.data || [];

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No members assigned to this card.' }] };
        }

        const list = members
          .map((m: any) =>
            [`ID: ${m.id}`, `Full Name: ${m.fullName || 'N/A'}`, `Username: ${m.username}`].join('\n'),
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${members.length} member(s):\n\n${list}` }],
        };
      }

      case 'trello_add_card_member': {
        const { card_id, member_id } = AddCardMemberSchema.parse(args);
        await client.post(`/cards/${card_id}/idMembers`, { value: member_id });

        return {
          content: [{ type: 'text', text: `Member ${member_id} added to card ${card_id} successfully.` }],
        };
      }

      case 'trello_remove_card_member': {
        const { card_id, member_id } = RemoveCardMemberSchema.parse(args);
        await client.delete(`/cards/${card_id}/idMembers/${member_id}`);

        return {
          content: [{ type: 'text', text: `Member ${member_id} removed from card ${card_id} successfully.` }],
        };
      }

      // ── Card Votes ──────────────────────────────────────────────────────

      case 'trello_get_card_votes': {
        const { card_id } = GetCardVotesSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/membersVoted`);
        const voters: any[] = response.data || [];

        if (voters.length === 0) {
          return { content: [{ type: 'text', text: 'No votes found for this card.' }] };
        }

        const list = voters
          .map((m: any) =>
            [`ID: ${m.id}`, `Full Name: ${m.fullName || 'N/A'}`, `Username: ${m.username}`].join('\n'),
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${voters.length} vote(s):\n\n${list}` }],
        };
      }

      case 'trello_add_card_vote': {
        const { card_id, member_id } = AddCardVoteSchema.parse(args);
        await client.post(`/cards/${card_id}/membersVoted`, { value: member_id });

        return {
          content: [{ type: 'text', text: `Vote added for member ${member_id} on card ${card_id} successfully.` }],
        };
      }

      case 'trello_remove_card_vote': {
        const { card_id, member_id } = RemoveCardVoteSchema.parse(args);
        await client.delete(`/cards/${card_id}/membersVoted/${member_id}`);

        return {
          content: [{ type: 'text', text: `Vote removed for member ${member_id} on card ${card_id} successfully.` }],
        };
      }

      // ── Card Labels ─────────────────────────────────────────────────────

      case 'trello_add_label_to_card': {
        const { card_id, label_id } = AddLabelToCardSchema.parse(args);
        await client.post(`/cards/${card_id}/idLabels`, { value: label_id });

        return {
          content: [{ type: 'text', text: `Label ${label_id} added to card ${card_id} successfully.` }],
        };
      }

      case 'trello_remove_label_from_card': {
        const { card_id, label_id } = RemoveLabelFromCardSchema.parse(args);
        await client.delete(`/cards/${card_id}/idLabels/${label_id}`);

        return {
          content: [{ type: 'text', text: `Label ${label_id} removed from card ${card_id} successfully.` }],
        };
      }

      // ── Card Stickers ───────────────────────────────────────────────────

      case 'trello_get_card_stickers': {
        const { card_id } = GetCardStickersSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/stickers`);
        const stickers: any[] = response.data || [];

        if (stickers.length === 0) {
          return { content: [{ type: 'text', text: 'No stickers found on this card.' }] };
        }

        const list = stickers
          .map((s: any) =>
            [
              `ID: ${s.id}`,
              `Image: ${s.image}`,
              `Top: ${s.top}`,
              `Left: ${s.left}`,
              `Z-Index: ${s.zIndex}`,
              `Rotate: ${s.rotate}`,
            ].join('\n'),
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${stickers.length} sticker(s):\n\n${list}` }],
        };
      }

      case 'trello_add_card_sticker': {
        const { card_id, image, top, left, zIndex, rotate } = AddCardStickerSchema.parse(args);

        const body: Record<string, any> = { image, top, left, zIndex };
        if (rotate !== undefined) body.rotate = rotate;

        const response = await client.post(`/cards/${card_id}/stickers`, body);
        const sticker = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Sticker added successfully.`,
                `ID: ${sticker.id}`,
                `Image: ${sticker.image}`,
                `Top: ${sticker.top}`,
                `Left: ${sticker.left}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_get_card_sticker': {
        const { card_id, sticker_id } = GetCardStickerSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/stickers/${sticker_id}`);
        const s = response.data;

        return {
          content: [
            {
              type: 'text',
              text: [
                `ID: ${s.id}`,
                `Image: ${s.image}`,
                `Top: ${s.top}`,
                `Left: ${s.left}`,
                `Z-Index: ${s.zIndex}`,
                `Rotate: ${s.rotate}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'trello_update_card_sticker': {
        const { card_id, sticker_id, top, left, zIndex, rotate } = UpdateCardStickerSchema.parse(args);

        const body: Record<string, any> = {};
        if (top !== undefined) body.top = top;
        if (left !== undefined) body.left = left;
        if (zIndex !== undefined) body.zIndex = zIndex;
        if (rotate !== undefined) body.rotate = rotate;

        await client.put(`/cards/${card_id}/stickers/${sticker_id}`, body);

        return {
          content: [{ type: 'text', text: `Sticker ${sticker_id} updated successfully.` }],
        };
      }

      case 'trello_delete_card_sticker': {
        const { card_id, sticker_id } = DeleteCardStickerSchema.parse(args);
        await client.delete(`/cards/${card_id}/stickers/${sticker_id}`);

        return {
          content: [{ type: 'text', text: `Sticker ${sticker_id} deleted successfully.` }],
        };
      }

      // ── Card Custom Fields ──────────────────────────────────────────────

      case 'trello_get_card_custom_field_items': {
        const { card_id } = GetCardCustomFieldItemsSchema.parse(args);
        const response = await client.get(`/cards/${card_id}/customFieldItems`);
        const items: any[] = response.data || [];

        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'No custom field values found on this card.' }] };
        }

        const list = items
          .map((item: any) => {
            const value = item.value
              ? Object.entries(item.value)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')
              : 'N/A';
            return [
              `ID: ${item.id}`,
              `Custom Field ID: ${item.idCustomField}`,
              `Model ID: ${item.idModel}`,
              `Value: ${value}`,
            ].join('\n');
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${items.length} custom field item(s):\n\n${list}` }],
        };
      }

      default:
        return null;
    }
  } catch (error: any) {
    const msg =
      error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}
