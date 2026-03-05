/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Topic Schemas ──────────────────────────────────────────────────────────

const CreateTopicSchema = z.object({
  name: z.string().describe('Name of the topic'),
});

const ListTopicsSchema = z.object({
  limit: z.number().optional().default(10).describe('Number of topics to return'),
  after: z.string().optional().describe('Pagination cursor: return results after this ID'),
  before: z.string().optional().describe('Pagination cursor: return results before this ID'),
});

const GetTopicSchema = z.object({
  topic_id: z.string().describe('The ID of the topic to retrieve'),
});

const UpdateTopicSchema = z.object({
  topic_id: z.string().describe('The ID of the topic to update'),
  name: z.string().describe('New name for the topic'),
});

const DeleteTopicSchema = z.object({
  topic_id: z.string().describe('The ID of the topic to delete'),
});

// ─── Segment Schemas ────────────────────────────────────────────────────────

const CreateSegmentSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to create the segment in'),
  name: z.string().describe('Name of the segment'),
  filter: z.record(z.any()).optional().describe('Filter criteria for the segment'),
});

const ListSegmentsSchema = z.object({
  audience_id: z.string().describe('The ID of the audience to list segments from'),
});

const GetSegmentSchema = z.object({
  audience_id: z.string().describe('The ID of the audience'),
  segment_id: z.string().describe('The ID of the segment to retrieve'),
});

const DeleteSegmentSchema = z.object({
  audience_id: z.string().describe('The ID of the audience'),
  segment_id: z.string().describe('The ID of the segment to delete'),
});

const AddContactToSegmentSchema = z.object({
  contact_id: z.string().describe('The ID of the contact to add'),
  segment_id: z.string().describe('The ID of the segment to add the contact to'),
});

const RemoveContactFromSegmentSchema = z.object({
  contact_id: z.string().describe('The ID of the contact to remove'),
  segment_id: z.string().describe('The ID of the segment to remove the contact from'),
});

// ─── Contact Property Schemas ───────────────────────────────────────────────

const ContactPropertyTypeEnum = z.enum(['string', 'number', 'boolean', 'date']);

const CreateContactPropertySchema = z.object({
  key: z.string().describe('The unique key identifier for the contact property'),
  type: ContactPropertyTypeEnum.describe('The data type of the property'),
  label: z.string().optional().describe('Human-readable label for the property'),
  fallback_value: z.string().optional().describe('Default fallback value for the property'),
});

const ListContactPropertiesSchema = z.object({});

const GetContactPropertySchema = z.object({
  property_id: z.string().describe('The ID of the contact property to retrieve'),
});

const UpdateContactPropertySchema = z.object({
  property_id: z.string().describe('The ID of the contact property to update'),
  fallback_value: z.string().describe('New fallback value (only fallback_value can be updated)'),
});

const DeleteContactPropertySchema = z.object({
  property_id: z.string().describe('The ID of the contact property to delete'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export function getTopicSegmentContactPropertyTools() {
  return [
    // Topics
    {
      name: 'resend_create_topic',
      description: 'Create a new topic to segment your audience by interests or preferences.',
      inputSchema: zodToJsonSchema(CreateTopicSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_topics',
      description: 'Retrieve a list of topics with optional pagination.',
      inputSchema: zodToJsonSchema(ListTopicsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_get_topic',
      description: 'Retrieve a single topic by its ID.',
      inputSchema: zodToJsonSchema(GetTopicSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_topic',
      description: 'Update an existing topic name.',
      inputSchema: zodToJsonSchema(UpdateTopicSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_topic',
      description: 'Remove an existing topic.',
      inputSchema: zodToJsonSchema(DeleteTopicSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Segments
    {
      name: 'resend_create_segment',
      description: 'Create a new segment within an audience to organize contacts.',
      inputSchema: zodToJsonSchema(CreateSegmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_segments',
      description: 'Retrieve a list of segments for an audience.',
      inputSchema: zodToJsonSchema(ListSegmentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_get_segment',
      description: 'Retrieve a single segment by its ID.',
      inputSchema: zodToJsonSchema(GetSegmentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_segment',
      description: 'Permanently delete a segment by its ID.',
      inputSchema: zodToJsonSchema(DeleteSegmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'resend_add_contact_to_segment',
      description: 'Add an existing contact to a specific segment for targeted communication.',
      inputSchema: zodToJsonSchema(AddContactToSegmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_remove_contact_from_segment',
      description: 'Remove an existing contact from a specific segment.',
      inputSchema: zodToJsonSchema(RemoveContactFromSegmentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    // Contact Properties
    {
      name: 'resend_create_contact_property',
      description: 'Create a new custom contact property (field) in Resend.',
      inputSchema: zodToJsonSchema(CreateContactPropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'resend_list_contact_properties',
      description: 'Retrieve a list of all contact property definitions.',
      inputSchema: zodToJsonSchema(ListContactPropertiesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_get_contact_property',
      description: 'Retrieve details about a specific contact property by its ID.',
      inputSchema: zodToJsonSchema(GetContactPropertySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_update_contact_property',
      description: 'Update an existing contact property fallback value (key and type cannot be changed).',
      inputSchema: zodToJsonSchema(UpdateContactPropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'resend_delete_contact_property',
      description: 'Remove an existing contact property from Resend.',
      inputSchema: zodToJsonSchema(DeleteContactPropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callTopicSegmentContactPropertyTool(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance
) {
  switch (name) {
    case 'resend_create_topic': {
      const body = CreateTopicSchema.parse(args);
      const response = await client.post('/topics', body);
      return {
        content: [{ type: 'text', text: `Topic created. ID: ${response.data.id} | Name: ${response.data.name}` }],
      };
    }

    case 'resend_list_topics': {
      const parsed = ListTopicsSchema.parse(args);
      const params: Record<string, any> = { limit: parsed.limit };
      if (parsed.after) params.after = parsed.after;
      if (parsed.before) params.before = parsed.before;
      const response = await client.get('/topics', { params });
      const topics = response.data.data || response.data;
      if (!topics || topics.length === 0) {
        return { content: [{ type: 'text', text: 'No topics found.' }] };
      }
      const list = topics.map((t: any) => `ID: ${t.id} | Name: ${t.name}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${topics.length} topics:\n\n${list}` }] };
    }

    case 'resend_get_topic': {
      const { topic_id } = GetTopicSchema.parse(args);
      const response = await client.get(`/topics/${topic_id}`);
      const t = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Topic: ${t.id}\nName: ${t.name}\nCreated: ${t.created_at}`,
          },
        ],
      };
    }

    case 'resend_update_topic': {
      const { topic_id, name } = UpdateTopicSchema.parse(args);
      const response = await client.patch(`/topics/${topic_id}`, { name });
      return {
        content: [{ type: 'text', text: `Topic ${response.data.id} updated to "${response.data.name}".` }],
      };
    }

    case 'resend_delete_topic': {
      const { topic_id } = DeleteTopicSchema.parse(args);
      await client.delete(`/topics/${topic_id}`);
      return {
        content: [{ type: 'text', text: `Topic ${topic_id} deleted successfully.` }],
      };
    }

    case 'resend_create_segment': {
      const { audience_id, ...body } = CreateSegmentSchema.parse(args);
      const response = await client.post(`/audiences/${audience_id}/segments`, body);
      return {
        content: [
          {
            type: 'text',
            text: `Segment created. ID: ${response.data.id} | Name: ${response.data.name}`,
          },
        ],
      };
    }

    case 'resend_list_segments': {
      const { audience_id } = ListSegmentsSchema.parse(args);
      const response = await client.get(`/audiences/${audience_id}/segments`);
      const segments = response.data.data || response.data;
      if (!segments || segments.length === 0) {
        return { content: [{ type: 'text', text: 'No segments found.' }] };
      }
      const list = segments.map((s: any) => `ID: ${s.id} | Name: ${s.name}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${segments.length} segments:\n\n${list}` }] };
    }

    case 'resend_get_segment': {
      const { audience_id, segment_id } = GetSegmentSchema.parse(args);
      const response = await client.get(`/audiences/${audience_id}/segments/${segment_id}`);
      const s = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Segment: ${s.id}\nName: ${s.name}\nCreated: ${s.created_at}`,
          },
        ],
      };
    }

    case 'resend_delete_segment': {
      const { audience_id, segment_id } = DeleteSegmentSchema.parse(args);
      await client.delete(`/audiences/${audience_id}/segments/${segment_id}`);
      return {
        content: [{ type: 'text', text: `Segment ${segment_id} deleted successfully.` }],
      };
    }

    case 'resend_add_contact_to_segment': {
      const { contact_id, segment_id } = AddContactToSegmentSchema.parse(args);
      await client.post(`/contacts/${contact_id}/segment/${segment_id}`);
      return {
        content: [{ type: 'text', text: `Contact ${contact_id} added to segment ${segment_id}.` }],
      };
    }

    case 'resend_remove_contact_from_segment': {
      const { contact_id, segment_id } = RemoveContactFromSegmentSchema.parse(args);
      await client.delete(`/contacts/${contact_id}/segment/${segment_id}`);
      return {
        content: [{ type: 'text', text: `Contact ${contact_id} removed from segment ${segment_id}.` }],
      };
    }

    case 'resend_create_contact_property': {
      const body = CreateContactPropertySchema.parse(args);
      const response = await client.post('/contact-properties', body);
      return {
        content: [
          {
            type: 'text',
            text: `Contact property created.\nID: ${response.data.id}\nKey: ${response.data.key}\nType: ${response.data.type}`,
          },
        ],
      };
    }

    case 'resend_list_contact_properties': {
      const response = await client.get('/contact-properties');
      const properties = response.data.data || response.data;
      if (!properties || properties.length === 0) {
        return { content: [{ type: 'text', text: 'No contact properties found.' }] };
      }
      const list = properties
        .map((p: any) => `ID: ${p.id} | Key: ${p.key} | Type: ${p.type}`)
        .join('\n');
      return { content: [{ type: 'text', text: `Found ${properties.length} contact properties:\n\n${list}` }] };
    }

    case 'resend_get_contact_property': {
      const { property_id } = GetContactPropertySchema.parse(args);
      const response = await client.get(`/contact-properties/${property_id}`);
      const p = response.data;
      return {
        content: [
          {
            type: 'text',
            text: `Contact Property: ${p.id}\nKey: ${p.key}\nType: ${p.type}\nLabel: ${p.label || 'N/A'}\nFallback: ${p.fallback_value || 'N/A'}`,
          },
        ],
      };
    }

    case 'resend_update_contact_property': {
      const { property_id, fallback_value } = UpdateContactPropertySchema.parse(args);
      const response = await client.patch(`/contact-properties/${property_id}`, { fallback_value });
      return {
        content: [{ type: 'text', text: `Contact property ${response.data.id} updated successfully.` }],
      };
    }

    case 'resend_delete_contact_property': {
      const { property_id } = DeleteContactPropertySchema.parse(args);
      await client.delete(`/contact-properties/${property_id}`);
      return {
        content: [{ type: 'text', text: `Contact property ${property_id} deleted successfully.` }],
      };
    }

    default:
      return null;
  }
}
