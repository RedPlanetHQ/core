/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const CreateWebhookSchema = z.object({
  callbackURL: z
    .string()
    .describe(
      'The HTTPS URL that will receive POST requests when the watched Trello model changes',
    ),
  idModel: z
    .string()
    .describe(
      'The ID of the Trello object to watch (board, card, list, member, or organization)',
    ),
  description: z
    .string()
    .optional()
    .describe('A human-readable description for this webhook'),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the webhook is active upon creation (default: true)'),
});

const GetWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to retrieve'),
});

const UpdateWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to update'),
  callbackURL: z
    .string()
    .optional()
    .describe('New HTTPS URL to receive webhook POST requests'),
  idModel: z
    .string()
    .optional()
    .describe('New Trello object ID to watch (board, card, list, member, or organization)'),
  description: z
    .string()
    .optional()
    .describe('New description for the webhook'),
  active: z
    .boolean()
    .optional()
    .describe('Set to true to activate or false to deactivate the webhook'),
});

const DeleteWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to delete'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_create_webhook',
      description:
        'Create a new Trello webhook that will POST event notifications to a callback URL whenever the specified board, card, list, member, or organization changes.',
      inputSchema: zodToJsonSchema(CreateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_webhook',
      description:
        'Get details of a specific Trello webhook by its ID, including its status and failure information.',
      inputSchema: zodToJsonSchema(GetWebhookSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_webhook',
      description:
        'Update the callback URL, watched model, description, or active status of an existing Trello webhook.',
      inputSchema: zodToJsonSchema(UpdateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_webhook',
      description:
        'Permanently delete a Trello webhook. The callback URL will no longer receive event notifications.',
      inputSchema: zodToJsonSchema(DeleteWebhookSchema),
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
      case 'trello_create_webhook': {
        const { callbackURL, idModel, description, active } = CreateWebhookSchema.parse(args);

        const body: Record<string, any> = { callbackURL, idModel, active };
        if (description) body.description = description;

        const response = await client.post('/webhooks/', body);
        const w = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Webhook created!\nID: ${w.id}\nDescription: ${w.description || 'N/A'}\nModel ID: ${w.idModel}\nCallback URL: ${w.callbackURL}\nActive: ${w.active}`,
            },
          ],
        };
      }

      case 'trello_get_webhook': {
        const { webhook_id } = GetWebhookSchema.parse(args);
        const response = await client.get(`/webhooks/${webhook_id}`);
        const w = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Webhook ID: ${w.id}\nDescription: ${w.description || 'N/A'}\nModel ID: ${w.idModel}\nCallback URL: ${w.callbackURL}\nActive: ${w.active}\nConsecutive Failures: ${w.consecutiveFailures ?? 0}\nFirst Failure Date: ${w.firstConsecutiveFailDate || 'N/A'}`,
            },
          ],
        };
      }

      case 'trello_update_webhook': {
        const { webhook_id, callbackURL, idModel, description, active } =
          UpdateWebhookSchema.parse(args);

        const body: Record<string, any> = {};
        if (callbackURL !== undefined) body.callbackURL = callbackURL;
        if (idModel !== undefined) body.idModel = idModel;
        if (description !== undefined) body.description = description;
        if (active !== undefined) body.active = active;

        await client.put(`/webhooks/${webhook_id}`, body);

        return {
          content: [{ type: 'text', text: `Webhook ${webhook_id} updated successfully.` }],
        };
      }

      case 'trello_delete_webhook': {
        const { webhook_id } = DeleteWebhookSchema.parse(args);
        await client.delete(`/webhooks/${webhook_id}`);

        return {
          content: [{ type: 'text', text: `Webhook ${webhook_id} deleted successfully.` }],
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
