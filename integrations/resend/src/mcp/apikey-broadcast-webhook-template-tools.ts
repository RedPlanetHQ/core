/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── API Key Schemas ────────────────────────────────────────────────────────

const CreateApiKeySchema = z.object({
  name: z.string().describe('Name for the new API key'),
  permission: z.enum(['full_access', 'sending_access']).optional().describe('Permission level for the API key'),
  domain_id: z.string().optional().describe('Domain ID to restrict the API key to a specific domain'),
});

const DeleteApiKeySchema = z.object({
  api_key_id: z.string().describe('The ID of the API key to delete'),
});

// ─── Broadcast Schemas ──────────────────────────────────────────────────────

const ListBroadcastsSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of broadcasts to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

const UpdateBroadcastSchema = z.object({
  broadcast_id: z.string().describe('The ID of the broadcast to update'),
  name: z.string().optional().describe('New name for the broadcast'),
  subject: z.string().optional().describe('New subject line'),
  html: z.string().optional().describe('New HTML content'),
  text: z.string().optional().describe('New plain text content'),
  audience_id: z.string().optional().describe('New audience ID for recipients'),
  from: z.string().optional().describe('New sender address'),
  reply_to: z.union([z.string(), z.array(z.string())]).optional().describe('New reply-to address'),
});

// ─── Webhook Schemas ────────────────────────────────────────────────────────

const WebhookEventSchema = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.complained',
  'email.bounced',
  'email.opened',
  'email.clicked',
  'contact.created',
  'contact.deleted',
  'contact.updated',
]);

const CreateWebhookSchema = z.object({
  endpoint: z.string().url().describe('The HTTPS URL that will receive webhook events'),
  events: z.array(WebhookEventSchema).describe('List of events to subscribe to'),
});

const ListWebhooksSchema = z.object({});

const GetWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to retrieve'),
});

const UpdateWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to update'),
  endpoint: z.string().url().optional().describe('New endpoint URL'),
  events: z.array(WebhookEventSchema).optional().describe('New list of events to subscribe to'),
  enabled: z.boolean().optional().describe('Enable or disable the webhook'),
});

const DeleteWebhookSchema = z.object({
  webhook_id: z.string().describe('The ID of the webhook to delete'),
});

// ─── Template Schemas ───────────────────────────────────────────────────────

const TemplateVariableSchema = z.object({
  name: z.string().describe('Variable name'),
  default_value: z.string().optional().describe('Default value for the variable'),
});

const CreateTemplateSchema = z.object({
  name: z.string().describe('Name of the template'),
  subject: z.string().optional().describe('Email subject line for the template'),
  html: z.string().optional().describe('HTML content of the template'),
  variables: z.array(TemplateVariableSchema).optional().describe('Template variables'),
});

const ListTemplatesSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of templates to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

const GetTemplateSchema = z.object({
  template_id: z.string().describe('The ID or alias of the template to retrieve'),
});

const UpdateTemplateSchema = z.object({
  template_id: z.string().describe('The ID of the template to update'),
  name: z.string().optional().describe('New template name'),
  subject: z.string().optional().describe('New subject line'),
  html: z.string().optional().describe('New HTML content'),
  variables: z.array(TemplateVariableSchema).optional().describe('Updated template variables'),
});

const DeleteTemplateSchema = z.object({
  template_id: z.string().describe('The ID of the template to delete'),
});

const PublishTemplateSchema = z.object({
  template_id: z.string().describe('The ID of the template to publish'),
});

const DuplicateTemplateSchema = z.object({
  template_id: z.string().describe('The ID of the template to duplicate'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function getApiKeyBroadcastWebhookTemplateTools() {
  return [
    // API Keys
    {
      name: 'resend_create_api_key',
      description: 'Create a new API key to authenticate communications with Resend.',
      inputSchema: zodToJsonSchema(CreateApiKeySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_delete_api_key',
      description: 'Remove an existing API key from Resend.',
      inputSchema: zodToJsonSchema(DeleteApiKeySchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Broadcasts
    {
      name: 'resend_list_broadcasts',
      description: 'Retrieve a list of broadcasts with optional pagination.',
      inputSchema: zodToJsonSchema(ListBroadcastsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_broadcast',
      description: 'Update an existing broadcast details like name, subject, content, or recipients.',
      inputSchema: zodToJsonSchema(UpdateBroadcastSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Webhooks
    {
      name: 'resend_create_webhook',
      description: 'Create a webhook to receive real-time notifications about email events.',
      inputSchema: zodToJsonSchema(CreateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_webhooks',
      description: 'Retrieve a list of webhooks for the authenticated user.',
      inputSchema: zodToJsonSchema(ListWebhooksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_get_webhook',
      description: 'Retrieve a single webhook configuration including endpoint, events, and signing secret.',
      inputSchema: zodToJsonSchema(GetWebhookSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_webhook',
      description: 'Update an existing webhook configuration (endpoint URL, events, enabled status).',
      inputSchema: zodToJsonSchema(UpdateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_webhook',
      description: 'Remove an existing webhook configuration.',
      inputSchema: zodToJsonSchema(DeleteWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Templates
    {
      name: 'resend_create_template',
      description: 'Create a new reusable email template in Resend with optional variables.',
      inputSchema: zodToJsonSchema(CreateTemplateSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_templates',
      description: 'Retrieve a list of email templates with optional pagination.',
      inputSchema: zodToJsonSchema(ListTemplatesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_get_template',
      description: 'Retrieve a single template by ID or alias.',
      inputSchema: zodToJsonSchema(GetTemplateSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_template',
      description: 'Update an existing email template properties (name, subject, HTML, variables).',
      inputSchema: zodToJsonSchema(UpdateTemplateSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_template',
      description: 'Delete an existing template from Resend.',
      inputSchema: zodToJsonSchema(DeleteTemplateSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'resend_publish_template',
      description: 'Publish a template to make it publicly available.',
      inputSchema: zodToJsonSchema(PublishTemplateSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_duplicate_template',
      description: 'Duplicate an existing template to create a copy.',
      inputSchema: zodToJsonSchema(DuplicateTemplateSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callApiKeyBroadcastWebhookTemplateTool(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance
) {
  switch (name) {
    case 'resend_create_api_key': {
      const body = CreateApiKeySchema.parse(args);
      const response = await client.post('/api-keys', body);
      return {
        content: [
          {
            type: 'text',
            text: `API key created.\nID: ${response.data.id}\nName: ${response.data.name}\nToken: ${response.data.token}`,
          },
        ],
      };
    }

    case 'resend_delete_api_key': {
      const { api_key_id } = DeleteApiKeySchema.parse(args);
      await client.delete(`/api-keys/${api_key_id}`);
      return {
        content: [{ type: 'text', text: `API key ${api_key_id} deleted successfully.` }],
      };
    }

    case 'resend_list_broadcasts': {
      const parsed = ListBroadcastsSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/broadcasts', { params });
      const broadcasts = response.data.data || response.data;
      if (!broadcasts || broadcasts.length === 0) {
        return { content: [{ type: 'text', text: 'No broadcasts found.' }] };
      }
      const list = broadcasts
        .map((b: any) => `ID: ${b.id} | Name: ${b.name} | Status: ${b.status}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${broadcasts.length} broadcasts:\n\n${list}` }] };
    }

    case 'resend_update_broadcast': {
      const { broadcast_id, ...body } = UpdateBroadcastSchema.parse(args);
      const response = await client.patch(`/broadcasts/${broadcast_id}`, body);
      return {
        content: [{ type: 'text', text: `Broadcast ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_create_webhook': {
      const body = CreateWebhookSchema.parse(args);
      const response = await client.post('/webhooks', body);
      return {
        content: [
          {
            type: 'text',
            text: `Webhook created.\nID: ${response.data.id}\nEndpoint: ${response.data.endpoint}\nSigning Secret: ${response.data.signing_secret}`,
          },
        ],
      };
    }

    case 'resend_list_webhooks': {
      const response = await client.get('/webhooks');
      const webhooks = response.data.data || response.data;
      if (!webhooks || webhooks.length === 0) {
        return { content: [{ type: 'text', text: 'No webhooks found.' }] };
      }
      const list = webhooks
        .map((w: any) => `ID: ${w.id} | Endpoint: ${w.endpoint} | Enabled: ${w.enabled}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${webhooks.length} webhooks:\n\n${list}` }] };
    }

    case 'resend_get_webhook': {
      const { webhook_id } = GetWebhookSchema.parse(args);
      const response = await client.get(`/webhooks/${webhook_id}`);
      const w = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Webhook: ${w.id}\nEndpoint: ${w.endpoint}\nEvents: ${(w.events || []).join(', ')}\nEnabled: ${w.enabled}\nCreated: ${w.created_at}`,
          },
        ],
      };
    }

    case 'resend_update_webhook': {
      const { webhook_id, ...body } = UpdateWebhookSchema.parse(args);
      const response = await client.patch(`/webhooks/${webhook_id}`, body);
      return {
        content: [{ type: 'text', text: `Webhook ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_delete_webhook': {
      const { webhook_id } = DeleteWebhookSchema.parse(args);
      await client.delete(`/webhooks/${webhook_id}`);
      return {
        content: [{ type: 'text', text: `Webhook ${webhook_id} deleted successfully.` }],
      };
    }

    case 'resend_create_template': {
      const body = CreateTemplateSchema.parse(args);
      const response = await client.post('/templates', body);
      return {
        content: [
          {
            type: 'text',
            text: `Template created. ID: ${response.data.id} | Name: ${response.data.name}`,
          },
        ],
      };
    }

    case 'resend_list_templates': {
      const parsed = ListTemplatesSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/templates', { params });
      const templates = response.data.data || response.data;
      if (!templates || templates.length === 0) {
        return { content: [{ type: 'text', text: 'No templates found.' }] };
      }
      const list = templates
        .map((t: any) => `ID: ${t.id} | Name: ${t.name}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${templates.length} templates:\n\n${list}` }] };
    }

    case 'resend_get_template': {
      const { template_id } = GetTemplateSchema.parse(args);
      const response = await client.get(`/templates/${template_id}`);
      const t = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Template: ${t.id}\nName: ${t.name}\nSubject: ${t.subject || 'N/A'}\nCreated: ${t.created_at}`,
          },
        ],
      };
    }

    case 'resend_update_template': {
      const { template_id, ...body } = UpdateTemplateSchema.parse(args);
      const response = await client.patch(`/templates/${template_id}`, body);
      return {
        content: [{ type: 'text', text: `Template ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_delete_template': {
      const { template_id } = DeleteTemplateSchema.parse(args);
      await client.delete(`/templates/${template_id}`);
      return {
        content: [{ type: 'text', text: `Template ${template_id} deleted successfully.` }],
      };
    }

    case 'resend_publish_template': {
      const { template_id } = PublishTemplateSchema.parse(args);
      await client.post(`/templates/${template_id}/publish`);
      return {
        content: [{ type: 'text', text: `Template ${template_id} published successfully.` }],
      };
    }

    case 'resend_duplicate_template': {
      const { template_id } = DuplicateTemplateSchema.parse(args);
      const response = await client.post(`/templates/${template_id}/duplicate`);
      return {
        content: [
          {
            type: 'text',
            text: `Template duplicated. New ID: ${response.data.id} | Name: ${response.data.name}`,
          },
        ],
      };
    }

    default:
      return null;
  }
}
