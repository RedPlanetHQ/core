/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const LabelColorEnum = z.enum([
  'yellow',
  'purple',
  'blue',
  'red',
  'green',
  'orange',
  'black',
  'sky',
  'pink',
  'lime',
]);

const GetLabelSchema = z.object({
  label_id: z.string().describe('The ID of the label to retrieve'),
});

const CreateLabelSchema = z.object({
  name: z.string().describe('The name of the label'),
  color: LabelColorEnum.nullable().describe(
    'The color of the label. Valid values: yellow, purple, blue, red, green, orange, black, sky, pink, lime. Use null for a colorless label.',
  ),
  idBoard: z.string().describe('The ID of the board to create the label on'),
});

const UpdateLabelSchema = z.object({
  label_id: z.string().describe('The ID of the label to update'),
  name: z.string().optional().describe('New name for the label'),
  color: LabelColorEnum.optional().describe(
    'New color for the label. Valid values: yellow, purple, blue, red, green, orange, black, sky, pink, lime.',
  ),
});

const DeleteLabelSchema = z.object({
  label_id: z.string().describe('The ID of the label to delete'),
});

const GetLabelBoardSchema = z.object({
  label_id: z.string().describe('The ID of the label'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_label',
      description: 'Get details of a specific Trello label by its ID.',
      inputSchema: zodToJsonSchema(GetLabelSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_label',
      description: 'Create a new label on a Trello board. Labels can be applied to cards for categorization.',
      inputSchema: zodToJsonSchema(CreateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_label',
      description: 'Update the name or color of an existing Trello label.',
      inputSchema: zodToJsonSchema(UpdateLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_label',
      description: 'Delete a Trello label from its board. This will also remove the label from all cards. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_label_board',
      description: 'Get the board that a specific Trello label belongs to.',
      inputSchema: zodToJsonSchema(GetLabelBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
      case 'trello_get_label': {
        const { label_id } = GetLabelSchema.parse(args);
        const response = await client.get(`/labels/${label_id}`);
        const label = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Label ID: ${label.id}\nName: ${label.name || '(unnamed)'}\nColor: ${label.color || 'none'}\nBoard ID: ${label.idBoard}`,
            },
          ],
        };
      }

      case 'trello_create_label': {
        const { name, color, idBoard } = CreateLabelSchema.parse(args);

        const params: Record<string, any> = { name, idBoard };
        if (color !== null && color !== undefined) params.color = color;

        const response = await client.post('/labels', params);
        const label = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Label created!\nID: ${label.id}\nName: ${label.name || '(unnamed)'}\nColor: ${label.color || 'none'}\nBoard ID: ${label.idBoard}`,
            },
          ],
        };
      }

      case 'trello_update_label': {
        const { label_id, name, color } = UpdateLabelSchema.parse(args);

        const params: Record<string, any> = {};
        if (name !== undefined) params.name = name;
        if (color !== undefined) params.color = color;

        await client.put(`/labels/${label_id}`, params);

        return {
          content: [{ type: 'text', text: `Label ${label_id} updated successfully.` }],
        };
      }

      case 'trello_delete_label': {
        const { label_id } = DeleteLabelSchema.parse(args);
        await client.delete(`/labels/${label_id}`);

        return {
          content: [{ type: 'text', text: `Label ${label_id} deleted successfully.` }],
        };
      }

      case 'trello_get_label_board': {
        const { label_id } = GetLabelBoardSchema.parse(args);
        const response = await client.get(`/labels/${label_id}/board`);
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

      default:
        return null;
    }
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}
