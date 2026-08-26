/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const PosSchema = z.union([z.number(), z.enum(['top', 'bottom'])]);

const GetListSchema = z.object({
  list_id: z.string().describe('The ID of the list to retrieve'),
});

const CreateListSchema = z.object({
  name: z.string().describe('The name of the list'),
  idBoard: z.string().describe('The ID of the board to create the list on'),
  pos: PosSchema.optional().describe('Position of the list on the board (number, "top", or "bottom")'),
  idListSource: z.string().optional().describe('The ID of an existing list to copy cards from into the new list'),
});

const UpdateListSchema = z.object({
  list_id: z.string().describe('The ID of the list to update'),
  name: z.string().optional().describe('New name for the list'),
  closed: z.boolean().optional().describe('Archive (true) or unarchive (false) the list'),
  pos: PosSchema.optional().describe('New position for the list (number, "top", or "bottom")'),
  subscribed: z.boolean().optional().describe('Whether the current member is subscribed to the list'),
  idBoard: z.string().optional().describe('The ID of the board to move the list to'),
});

const ArchiveListSchema = z.object({
  list_id: z.string().describe('The ID of the list to archive or unarchive'),
  value: z.boolean().describe('true to archive the list, false to unarchive it'),
});

const MoveListToBoardSchema = z.object({
  list_id: z.string().describe('The ID of the list to move'),
  board_id: z.string().describe('The ID of the destination board'),
});

const GetListActionsSchema = z.object({
  list_id: z.string().describe('The ID of the list'),
  filter: z.string().optional().describe('Action type filter (e.g. "createCard,updateCard")'),
  limit: z.number().optional().default(50).describe('Maximum number of actions to return (default: 50)'),
});

const GetListBoardSchema = z.object({
  list_id: z.string().describe('The ID of the list'),
});

const GetListCardsSchema = z.object({
  list_id: z.string().describe('The ID of the list'),
  filter: z.enum(['all', 'open', 'closed']).optional().default('open').describe('Filter cards by status (default: open)'),
});

const CreateCardInListSchema = z.object({
  list_id: z.string().describe('The ID of the list to create the card in'),
  name: z.string().describe('The name of the card'),
  desc: z.string().optional().describe('Description for the card'),
  due: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
});

const ArchiveAllCardsInListSchema = z.object({
  list_id: z.string().describe('The ID of the list whose cards will all be archived'),
});

const MoveAllCardsInListSchema = z.object({
  list_id: z.string().describe('The ID of the list whose cards will be moved'),
  idBoard: z.string().describe('The ID of the destination board'),
  idList: z.string().describe('The ID of the destination list'),
});

const UpdateListNameSchema = z.object({
  list_id: z.string().describe('The ID of the list to rename'),
  value: z.string().describe('The new name for the list'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_list',
      description: 'Get details of a specific Trello list by its ID.',
      inputSchema: zodToJsonSchema(GetListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_list',
      description: 'Create a new list on a Trello board. Optionally copy cards from an existing list.',
      inputSchema: zodToJsonSchema(CreateListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_list',
      description: 'Update one or more fields of an existing Trello list (name, archived state, position, subscription, or board).',
      inputSchema: zodToJsonSchema(UpdateListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_archive_list',
      description: 'Archive or unarchive a Trello list. Archived lists are hidden from the board but not deleted.',
      inputSchema: zodToJsonSchema(ArchiveListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_move_list_to_board',
      description: 'Move a Trello list to a different board.',
      inputSchema: zodToJsonSchema(MoveListToBoardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_list_actions',
      description: 'Get the activity actions on a Trello list such as card creations and moves.',
      inputSchema: zodToJsonSchema(GetListActionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_list_board',
      description: 'Get the board that a specific Trello list belongs to.',
      inputSchema: zodToJsonSchema(GetListBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_list_cards',
      description: 'Get cards in a Trello list, optionally filtered by their open or closed status.',
      inputSchema: zodToJsonSchema(GetListCardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_card_in_list',
      description: 'Create a new card directly in a Trello list.',
      inputSchema: zodToJsonSchema(CreateCardInListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_archive_all_cards_in_list',
      description: 'Archive all cards in a Trello list at once. This action cannot be undone in bulk.',
      inputSchema: zodToJsonSchema(ArchiveAllCardsInListSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_move_all_cards_in_list',
      description: 'Move all cards from one Trello list to another list on a specified board.',
      inputSchema: zodToJsonSchema(MoveAllCardsInListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_list_name',
      description: 'Rename a Trello list by updating its name field.',
      inputSchema: zodToJsonSchema(UpdateListNameSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance,
): Promise<any> {
  try {
    switch (name) {
      case 'trello_get_list': {
        const { list_id } = GetListSchema.parse(args);
        const response = await client.get(`/lists/${list_id}`);
        const l = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `List ID: ${l.id}\nName: ${l.name}\nBoard ID: ${l.idBoard}\nArchived: ${l.closed}\nPosition: ${l.pos}`,
            },
          ],
        };
      }

      case 'trello_create_list': {
        const { name, idBoard, pos, idListSource } = CreateListSchema.parse(args);

        const params: Record<string, any> = { name, idBoard };
        if (pos !== undefined) params.pos = pos;
        if (idListSource) params.idListSource = idListSource;

        const response = await client.post('/lists', params);
        const l = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `List created!\nID: ${l.id}\nName: ${l.name}\nBoard ID: ${l.idBoard}`,
            },
          ],
        };
      }

      case 'trello_update_list': {
        const { list_id, name, closed, pos, subscribed, idBoard } = UpdateListSchema.parse(args);

        const params: Record<string, any> = {};
        if (name !== undefined) params.name = name;
        if (closed !== undefined) params.closed = closed;
        if (pos !== undefined) params.pos = pos;
        if (subscribed !== undefined) params.subscribed = subscribed;
        if (idBoard !== undefined) params.idBoard = idBoard;

        await client.put(`/lists/${list_id}`, params);

        return {
          content: [{ type: 'text', text: `List ${list_id} updated successfully.` }],
        };
      }

      case 'trello_archive_list': {
        const { list_id, value } = ArchiveListSchema.parse(args);
        await client.put(`/lists/${list_id}/closed`, { value });

        const action = value ? 'archived' : 'unarchived';
        return {
          content: [{ type: 'text', text: `List ${list_id} ${action} successfully.` }],
        };
      }

      case 'trello_move_list_to_board': {
        const { list_id, board_id } = MoveListToBoardSchema.parse(args);
        await client.put(`/lists/${list_id}/idBoard`, { value: board_id });

        return {
          content: [{ type: 'text', text: `List ${list_id} moved to board ${board_id} successfully.` }],
        };
      }

      case 'trello_get_list_actions': {
        const { list_id, filter, limit } = GetListActionsSchema.parse(args);

        const params: Record<string, any> = { limit };
        if (filter) params.filter = filter;

        const response = await client.get(`/lists/${list_id}/actions`, { params });
        const actions: any[] = response.data || [];

        if (actions.length === 0) {
          return { content: [{ type: 'text', text: 'No actions found for this list.' }] };
        }

        const list = actions
          .map((a: any) => {
            const creator = a.memberCreator
              ? `${a.memberCreator.fullName || a.memberCreator.username} (@${a.memberCreator.username})`
              : 'N/A';
            return `ID: ${a.id}\nType: ${a.type}\nDate: ${a.date}\nCreated by: ${creator}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${actions.length} action(s):\n\n${list}` }],
        };
      }

      case 'trello_get_list_board': {
        const { list_id } = GetListBoardSchema.parse(args);
        const response = await client.get(`/lists/${list_id}/board`);
        const board = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Board ID: ${board.id}\nName: ${board.name}\nURL: ${board.url}`,
            },
          ],
        };
      }

      case 'trello_get_list_cards': {
        const { list_id, filter } = GetListCardsSchema.parse(args);
        const response = await client.get(`/lists/${list_id}/cards`, { params: { filter } });
        const cards: any[] = response.data || [];

        if (cards.length === 0) {
          return { content: [{ type: 'text', text: 'No cards found in this list.' }] };
        }

        const list = cards
          .map(
            (c: any) =>
              `ID: ${c.id}\nName: ${c.name}\nDescription: ${c.desc || 'N/A'}\nDue: ${c.due || 'N/A'}\nURL: ${c.url}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${cards.length} card(s):\n\n${list}` }],
        };
      }

      case 'trello_create_card_in_list': {
        const { list_id, name, desc, due } = CreateCardInListSchema.parse(args);

        const params: Record<string, any> = { name };
        if (desc) params.desc = desc;
        if (due) params.due = due;

        const response = await client.post(`/lists/${list_id}/cards`, params);
        const card = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Card created!\nID: ${card.id}\nName: ${card.name}\nURL: ${card.url}`,
            },
          ],
        };
      }

      case 'trello_archive_all_cards_in_list': {
        const { list_id } = ArchiveAllCardsInListSchema.parse(args);
        await client.post(`/lists/${list_id}/archiveAllCards`);

        return {
          content: [{ type: 'text', text: `All cards in list ${list_id} have been archived.` }],
        };
      }

      case 'trello_move_all_cards_in_list': {
        const { list_id, idBoard, idList } = MoveAllCardsInListSchema.parse(args);
        await client.post(`/lists/${list_id}/moveAllCards`, { idBoard, idList });

        return {
          content: [
            {
              type: 'text',
              text: `All cards in list ${list_id} moved to list ${idList} on board ${idBoard}.`,
            },
          ],
        };
      }

      case 'trello_update_list_name': {
        const { list_id, value } = UpdateListNameSchema.parse(args);
        await client.put(`/lists/${list_id}/name`, { value });

        return {
          content: [{ type: 'text', text: `List ${list_id} renamed to "${value}" successfully.` }],
        };
      }

      default:
        return null;
    }
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}
