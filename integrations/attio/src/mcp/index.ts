import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Attio API client
let attioClient: AxiosInstance;

/**
 * Initialize Attio client with API key
 */
function initializeClient(apiKey: string) {
  attioClient = axios.create({
    baseURL: 'https://api.attio.com/v2',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// People (Contacts) Schemas
const CreatePersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  email_addresses: z
    .array(z.string().email())
    .optional()
    .describe('List of email addresses'),
  phone_numbers: z.array(z.string()).optional().describe('List of phone numbers'),
  job_title: z.string().optional().describe('Job title'),
  company_name: z.string().optional().describe('Company name'),
  description: z.string().optional().describe('Description or notes about the person'),
});

const GetPersonSchema = z.object({
  record_id: z.string().describe('ID of the person record to retrieve'),
});

const UpdatePersonSchema = z.object({
  record_id: z.string().describe('ID of the person record to update'),
  name: z.string().optional().describe('Full name of the person'),
  email_addresses: z.array(z.string().email()).optional().describe('List of email addresses'),
  phone_numbers: z.array(z.string()).optional().describe('List of phone numbers'),
  job_title: z.string().optional().describe('Job title'),
  description: z.string().optional().describe('Description or notes about the person'),
});

const SearchPeopleSchema = z.object({
  query: z.string().describe('Search query to find people by name, email, etc.'),
  limit: z.number().optional().default(20).describe('Maximum number of results to return'),
});

const DeletePersonSchema = z.object({
  record_id: z.string().describe('ID of the person record to delete'),
});

// Company Schemas
const CreateCompanySchema = z.object({
  name: z.string().describe('Company name'),
  domains: z.array(z.string()).optional().describe('List of company domains (e.g. example.com)'),
  description: z.string().optional().describe('Description of the company'),
  industry: z.string().optional().describe('Industry the company operates in'),
  employee_count: z.number().optional().describe('Number of employees'),
});

const GetCompanySchema = z.object({
  record_id: z.string().describe('ID of the company record to retrieve'),
});

const UpdateCompanySchema = z.object({
  record_id: z.string().describe('ID of the company record to update'),
  name: z.string().optional().describe('Company name'),
  domains: z.array(z.string()).optional().describe('List of company domains'),
  description: z.string().optional().describe('Description of the company'),
  industry: z.string().optional().describe('Industry'),
  employee_count: z.number().optional().describe('Number of employees'),
});

const SearchCompaniesSchema = z.object({
  query: z.string().describe('Search query to find companies by name, domain, etc.'),
  limit: z.number().optional().default(20).describe('Maximum number of results to return'),
});

const DeleteCompanySchema = z.object({
  record_id: z.string().describe('ID of the company record to delete'),
});

// Notes Schemas
const CreateNoteSchema = z.object({
  parent_object: z
    .enum(['people', 'companies'])
    .describe('Object type to attach the note to (people or companies)'),
  parent_record_id: z.string().describe('ID of the record to attach the note to'),
  title: z.string().describe('Title of the note'),
  content_plaintext: z.string().describe('Plain text content of the note'),
});

const GetNoteSchema = z.object({
  note_id: z.string().describe('ID of the note to retrieve'),
});

const DeleteNoteSchema = z.object({
  note_id: z.string().describe('ID of the note to delete'),
});

const ListNotesSchema = z.object({
  parent_object: z
    .enum(['people', 'companies'])
    .optional()
    .describe('Filter notes by parent object type'),
  parent_record_id: z.string().optional().describe('Filter notes by parent record ID'),
  limit: z.number().optional().default(20).describe('Maximum number of notes to return'),
});

// Tasks Schemas
const CreateTaskSchema = z.object({
  content: z.string().describe('Content/description of the task'),
  deadline_at: z.string().optional().describe('Deadline for the task in ISO 8601 format'),
  is_completed: z.boolean().optional().default(false).describe('Whether the task is completed'),
  linked_record_ids: z
    .array(
      z.object({
        target_object: z.enum(['people', 'companies']),
        target_record_id: z.string(),
      })
    )
    .optional()
    .describe('Records to link this task to'),
});

const GetTaskSchema = z.object({
  task_id: z.string().describe('ID of the task to retrieve'),
});

const UpdateTaskSchema = z.object({
  task_id: z.string().describe('ID of the task to update'),
  content: z.string().optional().describe('Content/description of the task'),
  deadline_at: z.string().optional().describe('Deadline for the task in ISO 8601 format'),
  is_completed: z.boolean().optional().describe('Whether the task is completed'),
});

const DeleteTaskSchema = z.object({
  task_id: z.string().describe('ID of the task to delete'),
});

const ListTasksSchema = z.object({
  is_completed: z.boolean().optional().describe('Filter by completion status'),
  limit: z.number().optional().default(20).describe('Maximum number of tasks to return'),
});

// Lists Schemas
const ListListsSchema = z.object({
  limit: z.number().optional().default(20).describe('Maximum number of lists to return'),
});

const GetListSchema = z.object({
  list_id: z.string().describe('ID of the list to retrieve'),
});

const ListEntriesSchema = z.object({
  list_id: z.string().describe('ID of the list to get entries from'),
  limit: z.number().optional().default(20).describe('Maximum number of entries to return'),
});

// ============================================================================
// TOOLS REGISTRY
// ============================================================================

/**
 * Get list of available Attio tools
 */
export async function getTools() {
  return [
    // People tools
    {
      name: 'create_person',
      description: 'Creates a new person (contact) record in Attio CRM',
      inputSchema: zodToJsonSchema(CreatePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_person',
      description: 'Retrieves a person (contact) record by ID from Attio CRM',
      inputSchema: zodToJsonSchema(GetPersonSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_person',
      description: 'Updates an existing person (contact) record in Attio CRM',
      inputSchema: zodToJsonSchema(UpdatePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_people',
      description: 'Searches for people (contacts) in Attio CRM by name, email, or other attributes',
      inputSchema: zodToJsonSchema(SearchPeopleSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_person',
      description: 'Deletes a person (contact) record from Attio CRM',
      inputSchema: zodToJsonSchema(DeletePersonSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Company tools
    {
      name: 'create_company',
      description: 'Creates a new company record in Attio CRM',
      inputSchema: zodToJsonSchema(CreateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_company',
      description: 'Retrieves a company record by ID from Attio CRM',
      inputSchema: zodToJsonSchema(GetCompanySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_company',
      description: 'Updates an existing company record in Attio CRM',
      inputSchema: zodToJsonSchema(UpdateCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'search_companies',
      description: 'Searches for companies in Attio CRM by name, domain, or other attributes',
      inputSchema: zodToJsonSchema(SearchCompaniesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_company',
      description: 'Deletes a company record from Attio CRM',
      inputSchema: zodToJsonSchema(DeleteCompanySchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Notes tools
    {
      name: 'create_note',
      description: 'Creates a note and attaches it to a person or company record in Attio',
      inputSchema: zodToJsonSchema(CreateNoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_note',
      description: 'Retrieves a specific note by ID from Attio',
      inputSchema: zodToJsonSchema(GetNoteSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_notes',
      description: 'Lists notes in Attio, optionally filtered by parent record',
      inputSchema: zodToJsonSchema(ListNotesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_note',
      description: 'Deletes a note from Attio',
      inputSchema: zodToJsonSchema(DeleteNoteSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    // Tasks tools
    {
      name: 'create_task',
      description: 'Creates a new task in Attio CRM',
      inputSchema: zodToJsonSchema(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_task',
      description: 'Retrieves a specific task by ID from Attio',
      inputSchema: zodToJsonSchema(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_task',
      description: 'Updates an existing task in Attio (e.g., mark as completed)',
      inputSchema: zodToJsonSchema(UpdateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_task',
      description: 'Deletes a task from Attio',
      inputSchema: zodToJsonSchema(DeleteTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'list_tasks',
      description: 'Lists tasks in Attio, optionally filtered by completion status',
      inputSchema: zodToJsonSchema(ListTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // Lists tools
    {
      name: 'list_lists',
      description: 'Lists all lists (pipelines/views) in Attio',
      inputSchema: zodToJsonSchema(ListListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_list',
      description: 'Retrieves a specific list by ID from Attio',
      inputSchema: zodToJsonSchema(GetListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_entries',
      description: 'Lists entries (records) within a specific Attio list',
      inputSchema: zodToJsonSchema(ListEntriesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * Call a specific Attio tool
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  apiKey: string
) {
  initializeClient(apiKey);

  try {
    switch (name) {
      // ---- People operations ----
      case 'create_person': {
        const validated = CreatePersonSchema.parse(args);
        const values: Record<string, unknown> = {};

        if (validated.name) {
          const parts = validated.name.trim().split(/\s+/);
          values['name'] = [
            {
              first_name: parts[0] || '',
              last_name: parts.slice(1).join(' ') || '',
            },
          ];
        }
        if (validated.email_addresses?.length) {
          values['email_addresses'] = validated.email_addresses.map((e) => ({
            email_address: e,
          }));
        }
        if (validated.phone_numbers?.length) {
          values['phone_numbers'] = validated.phone_numbers.map((p) => ({
            phone_number: p,
          }));
        }
        if (validated.job_title) values['job_title'] = [{ value: validated.job_title }];
        if (validated.company_name) values['company_name'] = [{ value: validated.company_name }];
        if (validated.description) values['description'] = [{ value: validated.description }];

        const response = await attioClient.post('/objects/people/records', { data: { values } });
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Person created successfully:\nID: ${record?.id?.record_id}\nName: ${validated.name}`,
            },
          ],
        };
      }

      case 'get_person': {
        const validated = GetPersonSchema.parse(args);
        const response = await attioClient.get(
          `/objects/people/records/${validated.record_id}`
        );
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Person details:\nID: ${record?.id?.record_id}\n${JSON.stringify(record?.values, null, 2)}`,
            },
          ],
        };
      }

      case 'update_person': {
        const validated = UpdatePersonSchema.parse(args);
        const { record_id, ...fields } = validated;
        const values: Record<string, unknown> = {};

        if (fields.name) {
          const parts = fields.name.trim().split(/\s+/);
          values['name'] = [
            { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '' },
          ];
        }
        if (fields.email_addresses?.length) {
          values['email_addresses'] = fields.email_addresses.map((e) => ({
            email_address: e,
          }));
        }
        if (fields.phone_numbers?.length) {
          values['phone_numbers'] = fields.phone_numbers.map((p) => ({ phone_number: p }));
        }
        if (fields.job_title) values['job_title'] = [{ value: fields.job_title }];
        if (fields.description) values['description'] = [{ value: fields.description }];

        const response = await attioClient.patch(
          `/objects/people/records/${record_id}`,
          { data: { values } }
        );
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Person updated successfully:\nID: ${record?.id?.record_id}`,
            },
          ],
        };
      }

      case 'search_people': {
        const validated = SearchPeopleSchema.parse(args);
        const response = await attioClient.post('/objects/people/records/query', {
          filter: {
            name: { $contains: validated.query },
          },
          limit: validated.limit,
        });
        const records = response.data?.data || [];

        const results = records
          .map((r: Record<string, unknown>) => {
            const id = (r.id as Record<string, string>)?.record_id;
            const values = r.values as Record<string, Array<Record<string, unknown>>>;
            const firstName = values?.name?.[0]?.first_name || '';
            const lastName = values?.name?.[0]?.last_name || '';
            const email = (values?.email_addresses?.[0] as Record<string, string>)?.email_address || 'N/A';
            return `ID: ${id}\nName: ${firstName} ${lastName}\nEmail: ${email}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${records.length} people:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_person': {
        const validated = DeletePersonSchema.parse(args);
        await attioClient.delete(`/objects/people/records/${validated.record_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Person ${validated.record_id} deleted successfully`,
            },
          ],
        };
      }

      // ---- Company operations ----
      case 'create_company': {
        const validated = CreateCompanySchema.parse(args);
        const values: Record<string, unknown> = {};

        values['name'] = [{ value: validated.name }];
        if (validated.domains?.length) {
          values['domains'] = validated.domains.map((d) => ({ domain: d }));
        }
        if (validated.description) values['description'] = [{ value: validated.description }];
        if (validated.industry) values['industry'] = [{ value: validated.industry }];
        if (validated.employee_count !== undefined) {
          values['employee_count'] = [{ value: validated.employee_count }];
        }

        const response = await attioClient.post('/objects/companies/records', {
          data: { values },
        });
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Company created successfully:\nID: ${record?.id?.record_id}\nName: ${validated.name}`,
            },
          ],
        };
      }

      case 'get_company': {
        const validated = GetCompanySchema.parse(args);
        const response = await attioClient.get(
          `/objects/companies/records/${validated.record_id}`
        );
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Company details:\nID: ${record?.id?.record_id}\n${JSON.stringify(record?.values, null, 2)}`,
            },
          ],
        };
      }

      case 'update_company': {
        const validated = UpdateCompanySchema.parse(args);
        const { record_id, ...fields } = validated;
        const values: Record<string, unknown> = {};

        if (fields.name) values['name'] = [{ value: fields.name }];
        if (fields.domains?.length) {
          values['domains'] = fields.domains.map((d) => ({ domain: d }));
        }
        if (fields.description) values['description'] = [{ value: fields.description }];
        if (fields.industry) values['industry'] = [{ value: fields.industry }];
        if (fields.employee_count !== undefined) {
          values['employee_count'] = [{ value: fields.employee_count }];
        }

        const response = await attioClient.patch(
          `/objects/companies/records/${record_id}`,
          { data: { values } }
        );
        const record = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Company updated successfully:\nID: ${record?.id?.record_id}`,
            },
          ],
        };
      }

      case 'search_companies': {
        const validated = SearchCompaniesSchema.parse(args);
        const response = await attioClient.post('/objects/companies/records/query', {
          filter: {
            name: { $contains: validated.query },
          },
          limit: validated.limit,
        });
        const records = response.data?.data || [];

        const results = records
          .map((r: Record<string, unknown>) => {
            const id = (r.id as Record<string, string>)?.record_id;
            const values = r.values as Record<string, Array<Record<string, unknown>>>;
            const name = (values?.name?.[0] as Record<string, string>)?.value || 'N/A';
            const domain = (values?.domains?.[0] as Record<string, string>)?.domain || 'N/A';
            return `ID: ${id}\nName: ${name}\nDomain: ${domain}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${records.length} companies:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_company': {
        const validated = DeleteCompanySchema.parse(args);
        await attioClient.delete(`/objects/companies/records/${validated.record_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Company ${validated.record_id} deleted successfully`,
            },
          ],
        };
      }

      // ---- Notes operations ----
      case 'create_note': {
        const validated = CreateNoteSchema.parse(args);
        const response = await attioClient.post('/notes', {
          data: {
            parent_object: validated.parent_object,
            parent_record_id: validated.parent_record_id,
            title: validated.title,
            content_plaintext: validated.content_plaintext,
          },
        });
        const note = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Note created successfully:\nID: ${note?.id?.note_id}\nTitle: ${validated.title}`,
            },
          ],
        };
      }

      case 'get_note': {
        const validated = GetNoteSchema.parse(args);
        const response = await attioClient.get(`/notes/${validated.note_id}`);
        const note = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Note details:\nID: ${note?.id?.note_id}\nTitle: ${note?.title}\nContent: ${note?.content_plaintext}`,
            },
          ],
        };
      }

      case 'list_notes': {
        const validated = ListNotesSchema.parse(args);
        const params: Record<string, unknown> = { limit: validated.limit };
        if (validated.parent_object) params['parent_object'] = validated.parent_object;
        if (validated.parent_record_id) params['parent_record_id'] = validated.parent_record_id;

        const response = await attioClient.get('/notes', { params });
        const notes = response.data?.data || [];

        const results = notes
          .map(
            (n: Record<string, unknown>) =>
              `ID: ${(n.id as Record<string, string>)?.note_id}\nTitle: ${n.title || 'Untitled'}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${notes.length} notes:\n\n${results}`,
            },
          ],
        };
      }

      case 'delete_note': {
        const validated = DeleteNoteSchema.parse(args);
        await attioClient.delete(`/notes/${validated.note_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Note ${validated.note_id} deleted successfully`,
            },
          ],
        };
      }

      // ---- Tasks operations ----
      case 'create_task': {
        const validated = CreateTaskSchema.parse(args);
        const taskData: Record<string, unknown> = {
          content: validated.content,
          is_completed: validated.is_completed ?? false,
        };
        if (validated.deadline_at) taskData['deadline_at'] = validated.deadline_at;
        if (validated.linked_record_ids?.length) {
          taskData['linked_records'] = validated.linked_record_ids.map((lr) => ({
            target_object: lr.target_object,
            target_record_id: lr.target_record_id,
          }));
        }

        const response = await attioClient.post('/tasks', { data: taskData });
        const task = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Task created successfully:\nID: ${task?.id?.task_id}\nContent: ${validated.content}`,
            },
          ],
        };
      }

      case 'get_task': {
        const validated = GetTaskSchema.parse(args);
        const response = await attioClient.get(`/tasks/${validated.task_id}`);
        const task = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Task details:\nID: ${task?.id?.task_id}\nContent: ${task?.content}\nCompleted: ${task?.is_completed}\nDeadline: ${task?.deadline_at || 'None'}`,
            },
          ],
        };
      }

      case 'update_task': {
        const validated = UpdateTaskSchema.parse(args);
        const { task_id, ...fields } = validated;
        const taskData: Record<string, unknown> = {};

        if (fields.content !== undefined) taskData['content'] = fields.content;
        if (fields.is_completed !== undefined) taskData['is_completed'] = fields.is_completed;
        if (fields.deadline_at !== undefined) taskData['deadline_at'] = fields.deadline_at;

        const response = await attioClient.patch(`/tasks/${task_id}`, { data: taskData });
        const task = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `Task updated successfully:\nID: ${task?.id?.task_id}\nCompleted: ${task?.is_completed}`,
            },
          ],
        };
      }

      case 'delete_task': {
        const validated = DeleteTaskSchema.parse(args);
        await attioClient.delete(`/tasks/${validated.task_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Task ${validated.task_id} deleted successfully`,
            },
          ],
        };
      }

      case 'list_tasks': {
        const validated = ListTasksSchema.parse(args);
        const params: Record<string, unknown> = { limit: validated.limit };
        if (validated.is_completed !== undefined) params['is_completed'] = validated.is_completed;

        const response = await attioClient.get('/tasks', { params });
        const tasks = response.data?.data || [];

        const results = tasks
          .map(
            (t: Record<string, unknown>) =>
              `ID: ${(t.id as Record<string, string>)?.task_id}\nContent: ${t.content}\nCompleted: ${t.is_completed}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${tasks.length} tasks:\n\n${results}`,
            },
          ],
        };
      }

      // ---- Lists operations ----
      case 'list_lists': {
        const validated = ListListsSchema.parse(args);
        const response = await attioClient.get('/lists', { params: { limit: validated.limit } });
        const lists = response.data?.data || [];

        const results = lists
          .map(
            (l: Record<string, unknown>) =>
              `ID: ${(l.id as Record<string, string>)?.list_id}\nName: ${l.name}\nObject: ${l.parent_object}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${lists.length} lists:\n\n${results}`,
            },
          ],
        };
      }

      case 'get_list': {
        const validated = GetListSchema.parse(args);
        const response = await attioClient.get(`/lists/${validated.list_id}`);
        const list = response.data?.data;

        return {
          content: [
            {
              type: 'text',
              text: `List details:\nID: ${list?.id?.list_id}\nName: ${list?.name}\nObject: ${list?.parent_object}`,
            },
          ],
        };
      }

      case 'list_entries': {
        const validated = ListEntriesSchema.parse(args);
        const response = await attioClient.post(`/lists/${validated.list_id}/entries/query`, {
          limit: validated.limit,
        });
        const entries = response.data?.data || [];

        const results = entries
          .map(
            (e: Record<string, unknown>) =>
              `Entry ID: ${(e.id as Record<string, string>)?.entry_id}\nRecord: ${JSON.stringify((e as Record<string, unknown>).record_id)}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${entries.length} entries in list:\n\n${results}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
    const errorMessage =
      axiosError.response?.data?.message ||
      axiosError.response?.data?.error ||
      (error instanceof Error ? error.message : String(error));
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
}
