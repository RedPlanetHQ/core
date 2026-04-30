import { z } from 'zod';
import { getMetabaseClient } from '../utils';

const ListSchema = z.object({
  limit: z.number().optional().describe('Maximum number of results to return'),
});

const IdSchema = z.object({
  id: z.number().describe('Resource ID'),
});

const CreateDashboardSchema = z.object({
  name: z.string().describe('Dashboard name'),
  description: z.string().optional().describe('Dashboard description'),
  collection_id: z.number().optional().describe('Collection ID to place the dashboard in'),
});

const UpdateDashboardSchema = z.object({
  id: z.number().describe('Dashboard ID'),
  name: z.string().optional().describe('New name'),
  description: z.string().optional().describe('New description'),
});

const CreateQuestionSchema = z.object({
  name: z.string().describe('Question name'),
  database_id: z.number().describe('Database ID to query'),
  query: z.string().describe('SQL query string for the question'),
  collection_id: z.number().optional().describe('Collection ID to place the question in'),
  description: z.string().optional().describe('Question description'),
  display: z
    .string()
    .optional()
    .describe('Visualization type: table, line, bar, scalar, pie, etc. Defaults to table'),
});

const ExecuteQuerySchema = z.object({
  query: z.string().describe('SQL query to execute'),
  database_id: z.number().describe('Database ID to run the query on'),
});

const AddCardToDashboardSchema = z.object({
  dashboard_id: z.number().describe('Dashboard ID to add the card to'),
  card_id: z.number().describe('Card/question ID to attach'),
  row: z.number().optional().describe('Grid row position. Defaults to placement below existing cards'),
  col: z.number().optional().describe('Grid column position. Defaults to 0'),
  size_x: z.number().optional().describe('Width in grid units (1-24). Defaults to 12'),
  size_y: z.number().optional().describe('Height in grid units. Defaults to 8'),
});

export function getTools() {
  return [
    {
      name: 'list_dashboards',
      description: 'List all dashboards in Metabase',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(ListSchema),
    },
    {
      name: 'get_dashboard',
      description: 'Get details of a specific dashboard including its cards/questions',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'create_dashboard',
      description: 'Create a new dashboard in Metabase',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(CreateDashboardSchema),
    },
    {
      name: 'update_dashboard',
      description: 'Update a dashboard name or description',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(UpdateDashboardSchema),
    },
    {
      name: 'list_questions',
      description: 'List all saved questions (cards) in Metabase',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(ListSchema),
    },
    {
      name: 'create_question',
      description:
        'Create a new saved question (card) in Metabase from a native SQL query. Returns the created card including its id, which can be passed to add_card_to_dashboard.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(CreateQuestionSchema),
    },
    {
      name: 'add_card_to_dashboard',
      description:
        'Attach an existing saved question (card) to a dashboard. Appends the card to the dashboard layout via the v0.50+ PUT /api/dashboard/:id flow.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(AddCardToDashboardSchema),
    },
    {
      name: 'get_question',
      description: 'Get details of a specific saved question',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'execute_question',
      description: 'Execute a saved question and return its query results',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'execute_query',
      description: 'Execute an ad-hoc SQL query against a Metabase database connection',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(ExecuteQuerySchema),
    },
    {
      name: 'list_databases',
      description: 'List all database connections configured in Metabase',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(ListSchema),
    },
    {
      name: 'get_database_metadata',
      description: 'Get schema metadata for a database including tables and fields',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'sync_database_schema',
      description: 'Trigger a schema sync for a database connection',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'list_collections',
      description: 'List all collections in Metabase',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(ListSchema),
    },
    {
      name: 'get_collection_items',
      description: 'List items (dashboards, questions) inside a collection',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(IdSchema),
    },
    {
      name: 'get_recent_activity',
      description: 'Get recent activity across all Metabase resources',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: zodToJsonSchema(ListSchema),
    },
  ];
}

function zodToJsonSchema(schema: z.ZodType): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodType;
      properties[key] = zodFieldToJson(fieldSchema);
      if (!(fieldSchema instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return { type: 'object', properties, required };
  }
  return { type: 'object', properties: {} };
}

function zodFieldToJson(field: z.ZodType): any {
  if (field instanceof z.ZodOptional) {
    return zodFieldToJson(field.unwrap());
  }
  if (field instanceof z.ZodString) {
    return { type: 'string', description: (field as any)._def.description };
  }
  if (field instanceof z.ZodNumber) {
    return { type: 'number', description: (field as any)._def.description };
  }
  if (field instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: field.options,
      description: (field as any)._def.description,
    };
  }
  return { type: 'string' };
}

export async function callTool(name: string, args: any, config: Record<string, string>) {
  const client = getMetabaseClient(config.metabase_url, config.api_key);

  switch (name) {
    case 'list_dashboards': {
      const response = await client.get('/dashboard/');
      const dashboards = Array.isArray(response.data) ? response.data : response.data?.data || [];
      return JSON.stringify(dashboards.slice(0, args.limit || 50), null, 2);
    }

    case 'get_dashboard': {
      const { id } = IdSchema.parse(args);
      const response = await client.get(`/dashboard/${id}`);
      return JSON.stringify(response.data, null, 2);
    }

    case 'create_dashboard': {
      const body = CreateDashboardSchema.parse(args);
      const response = await client.post('/dashboard/', body);
      return JSON.stringify(response.data, null, 2);
    }

    case 'update_dashboard': {
      const { id, ...updates } = UpdateDashboardSchema.parse(args);
      const response = await client.put(`/dashboard/${id}`, updates);
      return JSON.stringify(response.data, null, 2);
    }

    case 'list_questions': {
      const response = await client.get('/card/');
      const cards = Array.isArray(response.data) ? response.data : [];
      return JSON.stringify(cards.slice(0, args.limit || 50), null, 2);
    }

    case 'create_question': {
      const body = CreateQuestionSchema.parse(args);
      const payload = {
        name: body.name,
        description: body.description,
        collection_id: body.collection_id,
        display: body.display || 'table',
        visualization_settings: {},
        dataset_query: {
          type: 'native',
          database: body.database_id,
          native: { query: body.query },
        },
      };
      const response = await client.post('/card', payload);
      return JSON.stringify(response.data, null, 2);
    }

    case 'add_card_to_dashboard': {
      const { dashboard_id, card_id, row, col, size_x, size_y } =
        AddCardToDashboardSchema.parse(args);

      const dashboardResp = await client.get(`/dashboard/${dashboard_id}`);
      const existing = Array.isArray(dashboardResp.data?.dashcards)
        ? dashboardResp.data.dashcards
        : [];

      const width = size_x ?? 12;
      const height = size_y ?? 8;
      const colPos = col ?? 0;
      const rowPos =
        row ??
        existing.reduce(
          (max: number, dc: any) => Math.max(max, (dc.row ?? 0) + (dc.size_y ?? 0)),
          0,
        );

      const newDashcard = {
        id: -1,
        card_id,
        row: rowPos,
        col: colPos,
        size_x: width,
        size_y: height,
        parameter_mappings: [],
        visualization_settings: {},
      };

      const response = await client.put(`/dashboard/${dashboard_id}`, {
        dashcards: [...existing, newDashcard],
      });
      return JSON.stringify(response.data, null, 2);
    }

    case 'get_question': {
      const { id } = IdSchema.parse(args);
      const response = await client.get(`/card/${id}`);
      return JSON.stringify(response.data, null, 2);
    }

    case 'execute_question': {
      const { id } = IdSchema.parse(args);
      const response = await client.post(`/card/${id}/query`);
      return JSON.stringify(response.data, null, 2);
    }

    case 'execute_query': {
      const { query, database_id } = ExecuteQuerySchema.parse(args);
      const response = await client.post('/dataset', {
        database: database_id,
        native: { query },
        type: 'native',
      });
      return JSON.stringify(response.data, null, 2);
    }

    case 'list_databases': {
      const response = await client.get('/database/');
      const dbs = response.data?.data || response.data || [];
      return JSON.stringify(Array.isArray(dbs) ? dbs.slice(0, args.limit || 50) : dbs, null, 2);
    }

    case 'get_database_metadata': {
      const { id } = IdSchema.parse(args);
      const response = await client.get(`/database/${id}/metadata`);
      return JSON.stringify(response.data, null, 2);
    }

    case 'sync_database_schema': {
      const { id } = IdSchema.parse(args);
      await client.post(`/database/${id}/sync_schema`);
      return JSON.stringify(
        { success: true, message: `Schema sync triggered for database ${id}` },
        null,
        2,
      );
    }

    case 'list_collections': {
      const response = await client.get('/collection/');
      const collections = Array.isArray(response.data) ? response.data : [];
      return JSON.stringify(collections.slice(0, args.limit || 50), null, 2);
    }

    case 'get_collection_items': {
      const { id } = IdSchema.parse(args);
      const response = await client.get(`/collection/${id}/items`);
      return JSON.stringify(response.data, null, 2);
    }

    case 'get_recent_activity': {
      const response = await client.get('/activity/recents', {
        params: { context: 'views' },
      });
      const activities = Array.isArray(response.data?.recents)
        ? response.data.recents
        : Array.isArray(response.data)
          ? response.data
          : [];
      return JSON.stringify(activities.slice(0, args.limit || 20), null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2);
  }
}
