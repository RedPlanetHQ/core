/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetTokenSchema = z.object({
  token: z.string().describe('The API token string to inspect'),
});

const GetTokenMemberSchema = z.object({
  token: z.string().describe('The API token string to retrieve the associated member for'),
});

const GetTokenWebhooksSchema = z.object({
  token: z.string().describe('The API token string to list webhooks for'),
});

const CreateTokenWebhookSchema = z.object({
  token: z.string().describe('The API token string to associate the webhook with'),
  callbackURL: z
    .string()
    .describe('The HTTPS URL that will receive POST requests when the watched model changes'),
  idModel: z
    .string()
    .describe(
      'The ID of the Trello object to monitor (board, card, list, member, or organization)',
    ),
  description: z
    .string()
    .optional()
    .describe('A human-readable description for this webhook'),
});

const DeleteTokenWebhookSchema = z.object({
  token: z.string().describe('The API token string the webhook belongs to'),
  webhook_id: z.string().describe('The ID of the webhook to delete'),
});

const DeleteTokenSchema = z.object({
  token: z.string().describe('The API token string to revoke — this will remove API access'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_token',
      description:
        'Retrieve details about a Trello API token, including its expiry date, associated member, and granted permissions.',
      inputSchema: zodToJsonSchema(GetTokenSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_token_member',
      description: 'Get the Trello member associated with a given API token.',
      inputSchema: zodToJsonSchema(GetTokenMemberSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_token_webhooks',
      description: 'List all webhooks registered for a given API token.',
      inputSchema: zodToJsonSchema(GetTokenWebhooksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_token_webhook',
      description:
        'Create a new webhook for a Trello API token that will POST events to the specified callback URL when the watched model changes.',
      inputSchema: zodToJsonSchema(CreateTokenWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_delete_token_webhook',
      description: 'Delete a specific webhook associated with a Trello API token.',
      inputSchema: zodToJsonSchema(DeleteTokenWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_delete_token',
      description:
        'Revoke a Trello API token, permanently removing API access granted by that token. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteTokenSchema),
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
      case 'trello_get_token': {
        const { token } = GetTokenSchema.parse(args);
        const response = await client.get(`/tokens/${token}`);
        const t = response.data;

        const permissions = Array.isArray(t.permissions)
          ? t.permissions.map((p: any) => `  - ${p.idModel}: ${p.modelType} (${p.read ? 'read' : ''}${p.write ? '/write' : ''})`).join('\n')
          : 'N/A';

        return {
          content: [
            {
              type: 'text',
              text: `Token ID: ${t.id}\nIdentifier: ${t.identifier || 'N/A'}\nDate Created: ${t.dateCreated || 'N/A'}\nDate Expires: ${t.dateExpires || 'never'}\nMember ID: ${t.idMember || 'N/A'}\nPermissions:\n${permissions}`,
            },
          ],
        };
      }

      case 'trello_get_token_member': {
        const { token } = GetTokenMemberSchema.parse(args);
        const response = await client.get(`/tokens/${token}/member`);
        const m = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Member ID: ${m.id}\nUsername: @${m.username}\nFull Name: ${m.fullName || 'N/A'}\nURL: ${m.url || 'N/A'}`,
            },
          ],
        };
      }

      case 'trello_get_token_webhooks': {
        const { token } = GetTokenWebhooksSchema.parse(args);
        const response = await client.get(`/tokens/${token}/webhooks`);
        const webhooks: any[] = response.data || [];

        if (webhooks.length === 0) {
          return { content: [{ type: 'text', text: 'No webhooks found for this token.' }] };
        }

        const list = webhooks
          .map(
            (w: any) =>
              `ID: ${w.id}\nDescription: ${w.description || 'N/A'}\nModel ID: ${w.idModel}\nCallback URL: ${w.callbackURL}\nActive: ${w.active}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${webhooks.length} webhook(s):\n\n${list}` }],
        };
      }

      case 'trello_create_token_webhook': {
        const { token, callbackURL, idModel, description } = CreateTokenWebhookSchema.parse(args);

        const body: Record<string, any> = { callbackURL, idModel };
        if (description) body.description = description;

        const response = await client.post(`/tokens/${token}/webhooks`, body);
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

      case 'trello_delete_token_webhook': {
        const { token, webhook_id } = DeleteTokenWebhookSchema.parse(args);
        await client.delete(`/tokens/${token}/webhooks/${webhook_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Webhook ${webhook_id} deleted successfully from token.`,
            },
          ],
        };
      }

      case 'trello_delete_token': {
        const { token } = DeleteTokenSchema.parse(args);
        await client.delete(`/tokens/${token}`);

        return {
          content: [
            {
              type: 'text',
              text: `Token revoked successfully. Warning: this has permanently removed API access granted by this token.`,
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
