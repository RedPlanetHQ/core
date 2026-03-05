/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Email Schemas ──────────────────────────────────────────────────────────

const AttachmentSchema = z.object({
  content: z.string().describe('Base64-encoded content of the attachment'),
  filename: z.string().describe('Name of the attached file'),
});

const TagSchema = z.object({
  name: z.string().describe('Tag name'),
  value: z.string().describe('Tag value'),
});

const SendEmailSchema = z.object({
  from: z.string().describe('Sender email address (e.g. "Name <email@domain.com>")'),
  to: z.union([z.string(), z.array(z.string())]).describe('Recipient email address or array of addresses'),
  subject: z.string().describe('Email subject line'),
  html: z.string().optional().describe('HTML body of the email'),
  text: z.string().optional().describe('Plain text body of the email'),
  cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
  bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
  reply_to: z.union([z.string(), z.array(z.string())]).optional().describe('Reply-to address'),
  scheduled_at: z.string().optional().describe('ISO 8601 datetime to schedule the email'),
  attachments: z.array(AttachmentSchema).optional().describe('File attachments'),
  tags: z.array(TagSchema).optional().describe('Email tags for tracking'),
  headers: z.record(z.string()).optional().describe('Custom email headers'),
});

const SendBatchEmailsSchema = z.object({
  emails: z.array(SendEmailSchema).describe('Array of up to 100 email objects to send'),
});

const RetrieveEmailSchema = z.object({
  email_id: z.string().describe('The ID of the email to retrieve'),
});

const ListEmailsSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of emails to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

const UpdateEmailSchema = z.object({
  email_id: z.string().describe('The ID of the scheduled email to update'),
  scheduled_at: z.string().describe('New ISO 8601 datetime to reschedule the email'),
});

const CancelEmailSchema = z.object({
  email_id: z.string().describe('The ID of the scheduled email to cancel'),
});

const GetEmailAttachmentSchema = z.object({
  email_id: z.string().describe('The ID of the email'),
  attachment_id: z.string().describe('The ID of the attachment'),
});

const ListEmailAttachmentsSchema = z.object({
  email_id: z.string().describe('The ID of the email to list attachments for'),
});

const ListReceivedEmailsSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of received emails to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

// ─── Audience Schemas ───────────────────────────────────────────────────────

const CreateAudienceSchema = z.object({
  name: z.string().describe('Name of the audience'),
});

const ListAudiencesSchema = z.object({});

const RetrieveAudienceSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to retrieve'),
});

const DeleteAudienceSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to delete'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function getEmailAudienceTools() {
  return [
    {
      name: 'resend_send_email',
      description: 'Send an email using Resend.',
      inputSchema: zodToJsonSchema(SendEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_send_batch_emails',
      description: 'Trigger up to 100 batch emails at once.',
      inputSchema: zodToJsonSchema(SendBatchEmailsSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_retrieve_email',
      description: 'Retrieve a single email by ID.',
      inputSchema: zodToJsonSchema(RetrieveEmailSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_list_emails',
      description: 'Retrieve a list of emails sent by your team. Supports pagination.',
      inputSchema: zodToJsonSchema(ListEmailsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_email',
      description: 'Update a scheduled email (reschedule it).',
      inputSchema: zodToJsonSchema(UpdateEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_cancel_email',
      description: 'Cancel a scheduled email.',
      inputSchema: zodToJsonSchema(CancelEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'resend_get_email_attachment',
      description: 'Retrieve a single attachment from a sent email.',
      inputSchema: zodToJsonSchema(GetEmailAttachmentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_list_email_attachments',
      description: 'Retrieve a list of attachments from a sent email.',
      inputSchema: zodToJsonSchema(ListEmailAttachmentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_list_received_emails',
      description: 'Retrieve a list of received emails for the authenticated user.',
      inputSchema: zodToJsonSchema(ListReceivedEmailsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_create_audience',
      description: 'Create a new audience (contact list) in Resend.',
      inputSchema: zodToJsonSchema(CreateAudienceSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_audiences',
      description: 'List all audiences in your Resend account.',
      inputSchema: zodToJsonSchema(ListAudiencesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_retrieve_audience',
      description: 'Retrieve a single audience by its ID.',
      inputSchema: zodToJsonSchema(RetrieveAudienceSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_audience',
      description: 'Remove an existing audience.',
      inputSchema: zodToJsonSchema(DeleteAudienceSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callEmailAudienceTool(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance
) {
  switch (name) {
    case 'resend_send_email': {
      const parsed = SendEmailSchema.parse(args);
      const response = await client.post('/emails', parsed);
      return {
        content: [{ type: 'text', text: `Email sent. ID: ${response.data.id}` }],
      };
    }

    case 'resend_send_batch_emails': {
      const { emails } = SendBatchEmailsSchema.parse(args);
      const response = await client.post('/emails/batch', emails);
      const data = response.data.data || response.data;
      const ids = Array.isArray(data) ? data.map((e: any) => e.id).join(', ') : JSON.stringify(data);
      return {
        content: [{ type: 'text', text: `Batch emails sent. IDs: ${ids}` }],
      };
    }

    case 'resend_retrieve_email': {
      const { email_id } = RetrieveEmailSchema.parse(args);
      const response = await client.get(`/emails/${email_id}`);
      const e = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Email: ${e.id}\nFrom: ${e.from}\nTo: ${e.to}\nSubject: ${e.subject}\nStatus: ${e.last_event}\nCreated: ${e.created_at}`,
          },
        ],
      };
    }

    case 'resend_list_emails': {
      const parsed = ListEmailsSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/emails', { params });
      const emails = response.data.data || response.data;
      if (!emails || emails.length === 0) {
        return { content: [{ type: 'text', text: 'No emails found.' }] };
      }
      const list = emails
        .map((e: any) => `ID: ${e.id} | To: ${e.to} | Subject: ${e.subject} | Status: ${e.last_event}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${emails.length} emails:\n\n${list}` }] };
    }

    case 'resend_update_email': {
      const { email_id, scheduled_at } = UpdateEmailSchema.parse(args);
      const response = await client.patch(`/emails/${email_id}`, { scheduled_at });
      return {
        content: [{ type: 'text', text: `Email ${response.data.id} rescheduled to ${scheduled_at}.` }],
      };
    }

    case 'resend_cancel_email': {
      const { email_id } = CancelEmailSchema.parse(args);
      await client.post(`/emails/${email_id}/cancel`);
      return {
        content: [{ type: 'text', text: `Email ${email_id} cancelled successfully.` }],
      };
    }

    case 'resend_get_email_attachment': {
      const { email_id, attachment_id } = GetEmailAttachmentSchema.parse(args);
      const response = await client.get(`/emails/${email_id}/attachments/${attachment_id}`);
      const a = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Attachment: ${a.id}\nFilename: ${a.filename}\nContent Type: ${a.content_type}\nSize: ${a.size} bytes`,
          },
        ],
      };
    }

    case 'resend_list_email_attachments': {
      const { email_id } = ListEmailAttachmentsSchema.parse(args);
      const response = await client.get(`/emails/${email_id}/attachments`);
      const attachments = response.data.data || response.data;
      if (!attachments || attachments.length === 0) {
        return { content: [{ type: 'text', text: 'No attachments found.' }] };
      }
      const list = attachments
        .map((a: any) => `ID: ${a.id} | Filename: ${a.filename} | Size: ${a.size} bytes`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${attachments.length} attachments:\n\n${list}` }] };
    }

    case 'resend_list_received_emails': {
      const parsed = ListReceivedEmailsSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/emails/received', { params });
      const emails = response.data.data || response.data;
      if (!emails || emails.length === 0) {
        return { content: [{ type: 'text', text: 'No received emails found.' }] };
      }
      const list = emails
        .map((e: any) => `ID: ${e.id} | From: ${e.from} | Subject: ${e.subject}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${emails.length} received emails:\n\n${list}` }] };
    }

    case 'resend_create_audience': {
      const { name } = CreateAudienceSchema.parse(args);
      const response = await client.post('/audiences', { name });
      return {
        content: [
          {
            type: 'text',
            text: `Audience created. ID: ${response.data.id} | Name: ${response.data.name}`,
          },
        ],
      };
    }

    case 'resend_list_audiences': {
      const response = await client.get('/audiences');
      const audiences = response.data.data || response.data;
      if (!audiences || audiences.length === 0) {
        return { content: [{ type: 'text', text: 'No audiences found.' }] };
      }
      const list = audiences.map((a: any) => `ID: ${a.id} | Name: ${a.name}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${audiences.length} audiences:\n\n${list}` }] };
    }

    case 'resend_retrieve_audience': {
      const { audience_id } = RetrieveAudienceSchema.parse(args);
      const response = await client.get(`/audiences/${audience_id}`);
      const a = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Audience: ${a.id}\nName: ${a.name}\nCreated: ${a.created_at}`,
          },
        ],
      };
    }

    case 'resend_delete_audience': {
      const { audience_id } = DeleteAudienceSchema.parse(args);
      await client.delete(`/audiences/${audience_id}`);
      return {
        content: [{ type: 'text', text: `Audience ${audience_id} deleted successfully.` }],
      };
    }

    default:
      return null;
  }
}
