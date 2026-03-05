/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Contact (Legacy) Schemas ───────────────────────────────────────────────

const CreateContactSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to add the contact to'),
  email: z.string().email().describe('Email address of the contact'),
  first_name: z.string().optional().describe('First name of the contact'),
  last_name: z.string().optional().describe('Last name of the contact'),
  unsubscribed: z.boolean().optional().describe('Whether the contact is unsubscribed'),
});

const ListContactsSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to list contacts from'),
});

const RetrieveContactSchema = z.object({
  audience_id: z.string().describe('The ID of the audience'),
  id: z.string().describe('The ID or email of the contact to retrieve'),
});

const DeleteContactSchema = z.object({
  audience_id: z.string().describe('The ID of the audience'),
  id: z.string().describe('The ID or email of the contact to delete'),
});

// ─── Contact V2 (Global) Schemas ────────────────────────────────────────────

const CreateContactV2Schema = z.object({
  email: z.string().email().describe('Email address of the contact'),
  first_name: z.string().optional().describe('First name'),
  last_name: z.string().optional().describe('Last name'),
  unsubscribed: z.boolean().optional().describe('Whether the contact is unsubscribed'),
});

const GetContactSchema = z.object({
  id: z.string().describe('The ID or email of the contact to retrieve (global endpoint)'),
});

const DeleteContactByIdSchema = z.object({
  id: z.string().describe('The ID of the contact to delete (global endpoint)'),
});

const ListAllContactsSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of contacts to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

const UpdateContactSchema = z.object({
  id: z.string().describe('The ID or email of the contact to update'),
  first_name: z.string().optional().describe('New first name'),
  last_name: z.string().optional().describe('New last name'),
  unsubscribed: z.boolean().optional().describe('Whether to unsubscribe the contact'),
});

const ListContactSegmentsSchema = z.object({
  contact_id: z.string().describe('The ID of the contact'),
});

const ListContactTopicsSchema = z.object({
  contact_id: z.string().describe('The ID of the contact'),
});

// ─── Domain Schemas ─────────────────────────────────────────────────────────

const CreateDomainSchema = z.object({
  name: z.string().describe('The domain name to add (e.g. "example.com")'),
  region: z.enum(['us-east-1', 'eu-west-1', 'sa-east-1']).optional().describe('AWS region for the domain'),
});

const ListDomainsSchema = z.object({});

const RetrieveDomainSchema = z.object({
  domain_id: z.string().describe('The ID of the domain to retrieve'),
});

const UpdateDomainSchema = z.object({
  domain_id: z.string().describe('The ID of the domain to update'),
  click_tracking: z.boolean().optional().describe('Enable or disable click tracking'),
  open_tracking: z.boolean().optional().describe('Enable or disable open tracking'),
  tls: z.enum(['enforced', 'opportunistic']).optional().describe('TLS setting for the domain'),
});

const DeleteDomainSchema = z.object({
  domain_id: z.string().describe('The ID of the domain to delete'),
});

const VerifyDomainSchema = z.object({
  domain_id: z.string().describe('The ID of the domain to verify'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function getContactDomainTools() {
  return [
    // Contact (legacy)
    {
      name: 'resend_create_contact',
      description: 'Create a contact in a specific Resend audience.',
      inputSchema: zodToJsonSchema(CreateContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_contacts',
      description: 'List contacts in a specific Resend audience.',
      inputSchema: zodToJsonSchema(ListContactsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_retrieve_contact',
      description: 'Retrieve a contact from a specific audience by ID or email.',
      inputSchema: zodToJsonSchema(RetrieveContactSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_contact',
      description: 'Delete a contact from a specific audience by ID or email.',
      inputSchema: zodToJsonSchema(DeleteContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Contact V2 (global)
    {
      name: 'resend_create_contact_v2',
      description: 'Create a new contact in Resend without specifying an audience (global endpoint).',
      inputSchema: zodToJsonSchema(CreateContactV2Schema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_get_contact',
      description: 'Retrieve a single contact from Resend by ID or email (global endpoint).',
      inputSchema: zodToJsonSchema(GetContactSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_contact_by_id',
      description: 'Remove an existing contact by its ID (global endpoint).',
      inputSchema: zodToJsonSchema(DeleteContactByIdSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'resend_list_all_contacts',
      description: 'Retrieve a list of all contacts from Resend across all audiences.',
      inputSchema: zodToJsonSchema(ListAllContactsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_contact',
      description: 'Update an existing contact in Resend by ID or email.',
      inputSchema: zodToJsonSchema(UpdateContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_list_contact_segments',
      description: 'Retrieve a list of segments that a contact belongs to.',
      inputSchema: zodToJsonSchema(ListContactSegmentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_list_contact_topics',
      description: 'Retrieve a list of topic subscriptions for a contact.',
      inputSchema: zodToJsonSchema(ListContactTopicsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Domains
    {
      name: 'resend_create_domain',
      description: 'Create a domain through the Resend Email API.',
      inputSchema: zodToJsonSchema(CreateDomainSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_domains',
      description: 'List all domains in your Resend account.',
      inputSchema: zodToJsonSchema(ListDomainsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_retrieve_domain',
      description: 'Retrieve a single domain by its ID.',
      inputSchema: zodToJsonSchema(RetrieveDomainSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_domain',
      description: 'Update an existing domain (tracking settings, TLS).',
      inputSchema: zodToJsonSchema(UpdateDomainSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_domain',
      description: 'Delete a domain through the Resend Email API.',
      inputSchema: zodToJsonSchema(DeleteDomainSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'resend_verify_domain',
      description: 'Verify a domain through the Resend Email API.',
      inputSchema: zodToJsonSchema(VerifyDomainSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callContactDomainTool(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance
) {
  switch (name) {
    case 'resend_create_contact': {
      const { audience_id, ...body } = CreateContactSchema.parse(args);
      const response = await client.post(`/audiences/${audience_id}/contacts`, body);
      return {
        content: [{ type: 'text', text: `Contact created. ID: ${response.data.id}` }],
      };
    }

    case 'resend_list_contacts': {
      const { audience_id } = ListContactsSchema.parse(args);
      const response = await client.get(`/audiences/${audience_id}/contacts`);
      const contacts = response.data.data || response.data;
      if (!contacts || contacts.length === 0) {
        return { content: [{ type: 'text', text: 'No contacts found.' }] };
      }
      const list = contacts
        .map((c: any) => `ID: ${c.id} | Email: ${c.email} | Name: ${c.first_name || ''} ${c.last_name || ''}`.trim())
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${contacts.length} contacts:\n\n${list}` }] };
    }

    case 'resend_retrieve_contact': {
      const { audience_id, id } = RetrieveContactSchema.parse(args);
      const response = await client.get(`/audiences/${audience_id}/contacts/${id}`);
      const c = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Contact: ${c.id}\nEmail: ${c.email}\nName: ${c.first_name || ''} ${c.last_name || ''}\nUnsubscribed: ${c.unsubscribed}`,
          },
        ],
      };
    }

    case 'resend_delete_contact': {
      const { audience_id, id } = DeleteContactSchema.parse(args);
      await client.delete(`/audiences/${audience_id}/contacts/${id}`);
      return {
        content: [{ type: 'text', text: `Contact ${id} deleted from audience ${audience_id}.` }],
      };
    }

    case 'resend_create_contact_v2': {
      const body = CreateContactV2Schema.parse(args);
      const response = await client.post('/contacts', body);
      return {
        content: [{ type: 'text', text: `Contact created. ID: ${response.data.id}` }],
      };
    }

    case 'resend_get_contact': {
      const { id } = GetContactSchema.parse(args);
      const response = await client.get(`/contacts/${id}`);
      const c = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Contact: ${c.id}\nEmail: ${c.email}\nName: ${c.first_name || ''} ${c.last_name || ''}\nUnsubscribed: ${c.unsubscribed}`,
          },
        ],
      };
    }

    case 'resend_delete_contact_by_id': {
      const { id } = DeleteContactByIdSchema.parse(args);
      await client.delete(`/contacts/${id}`);
      return {
        content: [{ type: 'text', text: `Contact ${id} deleted successfully.` }],
      };
    }

    case 'resend_list_all_contacts': {
      const parsed = ListAllContactsSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/contacts', { params });
      const contacts = response.data.data || response.data;
      if (!contacts || contacts.length === 0) {
        return { content: [{ type: 'text', text: 'No contacts found.' }] };
      }
      const list = contacts
        .map((c: any) => `ID: ${c.id} | Email: ${c.email}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${contacts.length} contacts:\n\n${list}` }] };
    }

    case 'resend_update_contact': {
      const { id, ...body } = UpdateContactSchema.parse(args);
      const response = await client.patch(`/contacts/${id}`, body);
      return {
        content: [{ type: 'text', text: `Contact ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_list_contact_segments': {
      const { contact_id } = ListContactSegmentsSchema.parse(args);
      const response = await client.get(`/contacts/${contact_id}/segments`);
      const segments = response.data.data || response.data;
      if (!segments || segments.length === 0) {
        return { content: [{ type: 'text', text: 'Contact is not in any segments.' }] };
      }
      const list = segments.map((s: any) => `ID: ${s.id} | Name: ${s.name}`).join('\n');
      return { content: [{ type: 'text', text: `Contact is in ${segments.length} segments:\n\n${list}` }] };
    }

    case 'resend_list_contact_topics': {
      const { contact_id } = ListContactTopicsSchema.parse(args);
      const response = await client.get(`/contacts/${contact_id}/topics`);
      const topics = response.data.data || response.data;
      if (!topics || topics.length === 0) {
        return { content: [{ type: 'text', text: 'Contact is not subscribed to any topics.' }] };
      }
      const list = topics.map((t: any) => `ID: ${t.id} | Name: ${t.name} | Status: ${t.subscription_status}`).join('\n');
      return { content: [{ type: 'text', text: `Contact topics:\n\n${list}` }] };
    }

    case 'resend_create_domain': {
      const body = CreateDomainSchema.parse(args);
      const response = await client.post('/domains', body);
      const d = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Domain created. ID: ${d.id} | Name: ${d.name} | Status: ${d.status}`,
          },
        ],
      };
    }

    case 'resend_list_domains': {
      const response = await client.get('/domains');
      const domains = response.data.data || response.data;
      if (!domains || domains.length === 0) {
        return { content: [{ type: 'text', text: 'No domains found.' }] };
      }
      const list = domains.map((d: any) => `ID: ${d.id} | Name: ${d.name} | Status: ${d.status}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${domains.length} domains:\n\n${list}` }] };
    }

    case 'resend_retrieve_domain': {
      const { domain_id } = RetrieveDomainSchema.parse(args);
      const response = await client.get(`/domains/${domain_id}`);
      const d = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Domain: ${d.id}\nName: ${d.name}\nStatus: ${d.status}\nRegion: ${d.region}\nCreated: ${d.created_at}`,
          },
        ],
      };
    }

    case 'resend_update_domain': {
      const { domain_id, ...body } = UpdateDomainSchema.parse(args);
      const response = await client.patch(`/domains/${domain_id}`, body);
      return {
        content: [{ type: 'text', text: `Domain ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_delete_domain': {
      const { domain_id } = DeleteDomainSchema.parse(args);
      await client.delete(`/domains/${domain_id}`);
      return {
        content: [{ type: 'text', text: `Domain ${domain_id} deleted successfully.` }],
      };
    }

    case 'resend_verify_domain': {
      const { domain_id } = VerifyDomainSchema.parse(args);
      await client.post(`/domains/${domain_id}/verify`);
      return {
        content: [{ type: 'text', text: `Domain ${domain_id} verification triggered successfully.` }],
      };
    }

    default:
      return null;
  }
}
