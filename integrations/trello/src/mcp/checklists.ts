/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const PosSchema = z.union([z.number(), z.enum(['top', 'bottom'])]);

const GetChecklistSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist to retrieve'),
});

const CreateChecklistSchema = z.object({
  idCard: z.string().describe('The ID of the card to add the checklist to'),
  name: z.string().describe('The name of the checklist'),
  pos: PosSchema.optional().describe('Position of the checklist on the card (number, "top", or "bottom")'),
  idChecklistSource: z.string().optional().describe('The ID of a checklist to copy items from'),
});

const UpdateChecklistSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist to update'),
  name: z.string().optional().describe('New name for the checklist'),
  pos: PosSchema.optional().describe('New position for the checklist (number, "top", or "bottom")'),
});

const DeleteChecklistSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist to delete'),
});

const GetChecklistBoardSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist'),
});

const GetChecklistCardsSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist'),
});

const GetChecklistItemsSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist'),
  filter: z.enum(['all', 'none']).optional().default('all').describe('Filter check items (default: all)'),
});

const AddChecklistItemSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist to add the item to'),
  name: z.string().describe('The name of the checklist item'),
  pos: PosSchema.optional().default('bottom').describe('Position of the new item (number, "top", or "bottom"; default: bottom)'),
  checked: z.boolean().optional().default(false).describe('Whether the item starts as checked (default: false)'),
});

const UpdateChecklistItemSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist that contains the item'),
  checkitem_id: z.string().describe('The ID of the checklist item to update'),
  name: z.string().optional().describe('New name for the checklist item'),
  state: z.enum(['complete', 'incomplete']).optional().describe('New state of the checklist item'),
  pos: PosSchema.optional().describe('New position for the checklist item (number, "top", or "bottom")'),
});

const DeleteChecklistItemSchema = z.object({
  checklist_id: z.string().describe('The ID of the checklist that contains the item'),
  checkitem_id: z.string().describe('The ID of the checklist item to delete'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_checklist',
      description: 'Get details of a specific Trello checklist by its ID, including its check items.',
      inputSchema: zodToJsonSchema(GetChecklistSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_checklist',
      description: 'Create a new checklist on a Trello card. Optionally copy items from an existing checklist.',
      inputSchema: zodToJsonSchema(CreateChecklistSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_checklist',
      description: 'Update the name or position of an existing Trello checklist.',
      inputSchema: zodToJsonSchema(UpdateChecklistSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_checklist',
      description: 'Delete a Trello checklist and all of its items. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteChecklistSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_checklist_board',
      description: 'Get the board that a checklist belongs to.',
      inputSchema: zodToJsonSchema(GetChecklistBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_checklist_cards',
      description: 'Get the cards associated with a Trello checklist.',
      inputSchema: zodToJsonSchema(GetChecklistCardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_checklist_items',
      description: 'Get all check items within a Trello checklist.',
      inputSchema: zodToJsonSchema(GetChecklistItemsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_checklist_item',
      description: 'Add a new item to an existing Trello checklist.',
      inputSchema: zodToJsonSchema(AddChecklistItemSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_checklist_item',
      description: 'Update the name, state, or position of a checklist item.',
      inputSchema: zodToJsonSchema(UpdateChecklistItemSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_checklist_item',
      description: 'Delete a specific item from a Trello checklist. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteChecklistItemSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
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
      case 'trello_get_checklist': {
        const { checklist_id } = GetChecklistSchema.parse(args);
        const response = await client.get(`/checklists/${checklist_id}`);
        const cl = response.data;

        const items: any[] = cl.checkItems || [];
        const itemList = items.length > 0
          ? items.map((item: any) => `  [${item.state === 'complete' ? 'x' : ' '}] ${item.name} (ID: ${item.id}, pos: ${item.pos})`).join('\n')
          : '  (none)';

        return {
          content: [
            {
              type: 'text',
              text: `Checklist ID: ${cl.id}\nName: ${cl.name}\nCard ID: ${cl.idCard}\nBoard ID: ${cl.idBoard}\nPosition: ${cl.pos}\nItems (${items.length}):\n${itemList}`,
            },
          ],
        };
      }

      case 'trello_create_checklist': {
        const { idCard, name, pos, idChecklistSource } = CreateChecklistSchema.parse(args);

        const params: Record<string, any> = { idCard, name };
        if (pos !== undefined) params.pos = pos;
        if (idChecklistSource) params.idChecklistSource = idChecklistSource;

        const response = await client.post('/checklists', params);
        const cl = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Checklist created!\nID: ${cl.id}\nName: ${cl.name}\nCard ID: ${cl.idCard}`,
            },
          ],
        };
      }

      case 'trello_update_checklist': {
        const { checklist_id, name, pos } = UpdateChecklistSchema.parse(args);

        const params: Record<string, any> = {};
        if (name !== undefined) params.name = name;
        if (pos !== undefined) params.pos = pos;

        await client.put(`/checklists/${checklist_id}`, params);

        return {
          content: [{ type: 'text', text: `Checklist ${checklist_id} updated successfully.` }],
        };
      }

      case 'trello_delete_checklist': {
        const { checklist_id } = DeleteChecklistSchema.parse(args);
        await client.delete(`/checklists/${checklist_id}`);

        return {
          content: [{ type: 'text', text: `Checklist ${checklist_id} deleted successfully.` }],
        };
      }

      case 'trello_get_checklist_board': {
        const { checklist_id } = GetChecklistBoardSchema.parse(args);
        const response = await client.get(`/checklists/${checklist_id}/board`);
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

      case 'trello_get_checklist_cards': {
        const { checklist_id } = GetChecklistCardsSchema.parse(args);
        const response = await client.get(`/checklists/${checklist_id}/cards`);
        const cards: any[] = response.data || [];

        if (cards.length === 0) {
          return { content: [{ type: 'text', text: 'No cards found for this checklist.' }] };
        }

        const list = cards
          .map((c: any) => `ID: ${c.id}\nName: ${c.name}\nURL: ${c.url}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${cards.length} card(s):\n\n${list}` }],
        };
      }

      case 'trello_get_checklist_items': {
        const { checklist_id, filter } = GetChecklistItemsSchema.parse(args);
        const response = await client.get(`/checklists/${checklist_id}/checkItems`, {
          params: { filter },
        });
        const items: any[] = response.data || [];

        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'No check items found in this checklist.' }] };
        }

        const list = items
          .map((item: any) => `ID: ${item.id}\nName: ${item.name}\nState: ${item.state}\nPosition: ${item.pos}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${items.length} item(s):\n\n${list}` }],
        };
      }

      case 'trello_add_checklist_item': {
        const { checklist_id, name, pos, checked } = AddChecklistItemSchema.parse(args);

        const params: Record<string, any> = { name };
        if (pos !== undefined) params.pos = pos;
        if (checked !== undefined) params.checked = checked;

        const response = await client.post(`/checklists/${checklist_id}/checkItems`, params);
        const item = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Check item added!\nID: ${item.id}\nName: ${item.name}\nState: ${item.state}`,
            },
          ],
        };
      }

      case 'trello_update_checklist_item': {
        const { checklist_id, checkitem_id, name, state, pos } = UpdateChecklistItemSchema.parse(args);

        const params: Record<string, any> = {};
        if (name !== undefined) params.name = name;
        if (state !== undefined) params.state = state;
        if (pos !== undefined) params.pos = pos;

        await client.put(`/checklists/${checklist_id}/checkItems/${checkitem_id}`, params);

        return {
          content: [{ type: 'text', text: `Check item ${checkitem_id} updated successfully.` }],
        };
      }

      case 'trello_delete_checklist_item': {
        const { checklist_id, checkitem_id } = DeleteChecklistItemSchema.parse(args);
        await client.delete(`/checklists/${checklist_id}/checkItems/${checkitem_id}`);

        return {
          content: [{ type: 'text', text: `Check item ${checkitem_id} deleted from checklist ${checklist_id}.` }],
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
