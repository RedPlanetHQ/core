/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getAuthHeaders } from '../utils';

let confluenceClient: AxiosInstance;

function initializeClient(config: Record<string, string>) {
  const headers = getAuthHeaders(config.access_token);
  const cloudId = config.cloud_id;

  confluenceClient = axios.create({
    baseURL: `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2`,
    headers,
  });
}

// ─── Confluence Schemas ────────────────────────────────────────────────────

const ConfluenceSearchSchema = z.object({
  cql: z.string().describe('CQL query string (e.g. "type = page AND space = DEV AND text ~ search term")'),
  limit: z.number().optional().default(20).describe('Max results to return (default 20)'),
  start: z.number().optional().default(0).describe('Index of the first result'),
});

const ConfluenceGetPageSchema = z.object({
  page_id: z.string().describe('The ID of the Confluence page'),
  body_format: z
    .enum(['storage', 'atlas_doc_format', 'view'])
    .optional()
    .default('storage')
    .describe('Format for page body content'),
});

const ConfluenceCreatePageSchema = z.object({
  space_id: z.string().describe('The ID of the space to create the page in'),
  title: z.string().describe('Page title'),
  body: z.string().optional().describe('Page body in storage format (XHTML)'),
  parent_id: z.string().optional().describe('Parent page ID (for nested pages)'),
  status: z
    .enum(['current', 'draft'])
    .optional()
    .default('current')
    .describe('Page status'),
});

const ConfluenceUpdatePageSchema = z.object({
  page_id: z.string().describe('The ID of the page to update'),
  title: z.string().describe('Page title (required even if unchanged)'),
  body: z.string().optional().describe('New page body in storage format (XHTML)'),
  version_number: z.number().describe('New version number (current version + 1)'),
  status: z
    .enum(['current', 'draft'])
    .optional()
    .default('current')
    .describe('Page status'),
});

const ConfluenceListSpacesSchema = z.object({
  limit: z.number().optional().default(25).describe('Max spaces to return'),
  start: z.number().optional().default(0).describe('Index of the first result'),
  type: z
    .enum(['global', 'personal'])
    .optional()
    .describe('Filter by space type'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'confluence_search',
      description: 'Search Confluence content using CQL (Confluence Query Language).',
      inputSchema: zodToJsonSchema(ConfluenceSearchSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_get_page',
      description: 'Get a Confluence page by its ID, including body content.',
      inputSchema: zodToJsonSchema(ConfluenceGetPageSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_create_page',
      description: 'Create a new Confluence page in a space.',
      inputSchema: zodToJsonSchema(ConfluenceCreatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'confluence_update_page',
      description: 'Update an existing Confluence page. Requires the new version number.',
      inputSchema: zodToJsonSchema(ConfluenceUpdatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'confluence_list_spaces',
      description: 'List Confluence spaces accessible to the authenticated user.',
      inputSchema: zodToJsonSchema(ConfluenceListSpacesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  initializeClient(config);

  try {
    switch (name) {
      case 'confluence_search': {
        const { cql, limit, start } = ConfluenceSearchSchema.parse(args);
        const response = await confluenceClient.get('/search', {
          params: { cql, limit, start },
        });

        const results = response.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        const list = results
          .map((r: any) => {
            const content = r.content || r;
            return `ID: ${content.id}\nTitle: ${content.title}\nType: ${content.type || 'N/A'}\nStatus: ${content.status || 'N/A'}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} results:\n\n${list}`,
            },
          ],
        };
      }

      case 'confluence_get_page': {
        const { page_id, body_format } = ConfluenceGetPageSchema.parse(args);
        const response = await confluenceClient.get(`/pages/${page_id}`, {
          params: { 'body-format': body_format },
        });

        const page = response.data;
        const body = page.body?.[body_format]?.value || 'No content';

        return {
          content: [
            {
              type: 'text',
              text: `Page: ${page.title}\nID: ${page.id}\nStatus: ${page.status}\nVersion: ${page.version?.number || 'N/A'}\nCreated: ${page.createdAt || 'N/A'}\n\nContent:\n${body}`,
            },
          ],
        };
      }

      case 'confluence_create_page': {
        const { space_id, title, body, parent_id, status } =
          ConfluenceCreatePageSchema.parse(args);

        const pageData: Record<string, any> = {
          spaceId: space_id,
          title,
          status,
        };

        if (body) {
          pageData.body = {
            representation: 'storage',
            value: body,
          };
        }

        if (parent_id) {
          pageData.parentId = parent_id;
        }

        const response = await confluenceClient.post('/pages', pageData);
        const page = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Page created!\nID: ${page.id}\nTitle: ${page.title}\nStatus: ${page.status}\nVersion: ${page.version?.number || 1}`,
            },
          ],
        };
      }

      case 'confluence_update_page': {
        const { page_id, title, body, version_number, status } =
          ConfluenceUpdatePageSchema.parse(args);

        const pageData: Record<string, any> = {
          id: page_id,
          title,
          status,
          version: { number: version_number },
        };

        if (body) {
          pageData.body = {
            representation: 'storage',
            value: body,
          };
        }

        const response = await confluenceClient.put(`/pages/${page_id}`, pageData);
        const page = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Page updated!\nID: ${page.id}\nTitle: ${page.title}\nStatus: ${page.status}\nVersion: ${page.version?.number}`,
            },
          ],
        };
      }

      case 'confluence_list_spaces': {
        const { limit, start, type } = ConfluenceListSpacesSchema.parse(args);
        const params: Record<string, any> = { limit, start };
        if (type) params.type = type;

        const response = await confluenceClient.get('/spaces', { params });
        const spaces = response.data.results || [];

        if (spaces.length === 0) {
          return { content: [{ type: 'text', text: 'No spaces found.' }] };
        }

        const list = spaces
          .map(
            (s: any) =>
              `ID: ${s.id}\nKey: ${s.key}\nName: ${s.name}\nType: ${s.type || 'N/A'}\nStatus: ${s.status || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${spaces.length} spaces:\n\n${list}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.errorMessages?.[0] ||
      error.response?.data?.message ||
      error.response?.data?.errors?.[0]?.message ||
      error.message;
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    };
  }
}
