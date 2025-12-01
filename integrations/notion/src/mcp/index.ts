import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

let notionClient: AxiosInstance;

async function initializeClient(config: Record<string, string>) {
  let accessToken = config.access_token;

  notionClient = axios.create({
    baseURL: 'https://api.notion.com/v1',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  });
}

// Schemas - organized by category
const schemas = {
  // PAGE TOOLS
  createPage: z.object({
    page: z.object({
      content: z.string().describe('Markdown content'),
      properties: z.object({ title: z.string().describe('Page title') }),
    }),
    parent: z
      .object({
        page_id: z.string().optional().describe('Parent page ID'),
        database_id: z.string().optional().describe('Parent database ID'),
        workspace: z.boolean().optional().describe('Create in workspace'),
      })
      .optional(),
    icon: z.object({}).optional(),
    cover: z.object({}).optional(),
  }),
  getPage: z.object({
    page_id: z.string().describe('Page ID'),
    filter_properties: z.array(z.string()).optional().describe('Filter properties'),
  }),
  updatePage: z.object({
    page_id: z.string().describe('Page ID'),
    properties: z.object({}).describe('Properties to update'),
    icon: z.object({}).optional(),
    cover: z.object({}).optional(),
    archived: z.boolean().optional(),
    in_trash: z.boolean().optional(),
  }),
  retrievePageProperty: z.object({
    page_id: z.string().describe('Page ID'),
    property_id: z.string().describe('Property ID'),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),

  // DATABASE TOOLS
  queryDatabase: z.object({
    database_id: z.string().describe('Database ID'),
    filter: z.object({}).optional(),
    sorts: z.array(z.object({})).optional(),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
  getDatabase: z.object({ database_id: z.string().describe('Database ID') }),
  createDatabase: z.object({
    parent: z.object({}).describe('Parent page object'),
    title: z.array(z.object({})).describe('Database title'),
    properties: z.object({}).describe('Properties schema'),
    icon: z.object({}).optional(),
    cover: z.object({}).optional(),
  }),
  updateDatabase: z.object({
    database_id: z.string().describe('Database ID'),
    title: z.array(z.object({})).optional(),
    properties: z.object({}).optional(),
    archived: z.boolean().optional(),
  }),
  createDatabaseItem: z.object({
    database_id: z.string().describe('Database ID'),
    properties: z.object({}).describe('Item properties'),
    children: z.array(z.object({})).optional(),
  }),

  // BLOCK TOOLS
  retrieveBlock: z.object({ block_id: z.string().describe('Block ID') }),
  updateBlock: z.object({
    block_id: z.string().describe('Block ID'),
    block_type: z.object({}).optional(),
    archived: z.boolean().optional(),
  }),
  deleteBlock: z.object({ block_id: z.string().describe('Block ID') }),
  getBlockChildren: z.object({
    block_id: z.string().describe('Block ID'),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
  appendBlockChildren: z.object({
    block_id: z.string().describe('Parent block ID'),
    children: z.array(z.object({})).describe('Blocks to append'),
    after: z.string().optional(),
  }),

  // SEARCH & USER TOOLS
  search: z.object({
    query: z.string().optional().describe('Search query'),
    filter: z.object({}).optional(),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
  getUser: z.object({ user_id: z.string().describe('User ID') }),
  listUsers: z.object({
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
  getMe: z.object({}),

  // COMMENT TOOLS
  createComment: z.object({
    parent: z.object({}).optional(),
    rich_text: z.array(z.object({})).describe('Comment content'),
    discussion_id: z.string().optional(),
  }),
  getComments: z.object({
    block_id: z.string().describe('Block ID'),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
};

export async function getTools() {
  return [
    // Page tools (4)
    {
      name: 'notion_create_page',
      description: 'Create a new page',
      inputSchema: zodToJsonSchema(schemas.createPage),
    },
    {
      name: 'notion_get_page',
      description: 'Retrieve a page',
      inputSchema: zodToJsonSchema(schemas.getPage),
    },
    {
      name: 'notion_update_page_properties',
      description: 'Update page properties',
      inputSchema: zodToJsonSchema(schemas.updatePage),
    },
    {
      name: 'notion_retrieve_page_property',
      description: 'Retrieve page property',
      inputSchema: zodToJsonSchema(schemas.retrievePageProperty),
    },

    // Database tools (5)
    {
      name: 'notion_query_database',
      description: 'Query a database',
      inputSchema: zodToJsonSchema(schemas.queryDatabase),
    },
    {
      name: 'notion_get_database',
      description: 'Retrieve a database',
      inputSchema: zodToJsonSchema(schemas.getDatabase),
    },
    {
      name: 'notion_create_database',
      description: 'Create a database',
      inputSchema: zodToJsonSchema(schemas.createDatabase),
    },
    {
      name: 'notion_update_database',
      description: 'Update a database',
      inputSchema: zodToJsonSchema(schemas.updateDatabase),
    },
    {
      name: 'notion_create_database_item',
      description: 'Create database item',
      inputSchema: zodToJsonSchema(schemas.createDatabaseItem),
    },

    // Block tools (5)
    {
      name: 'notion_retrieve_block',
      description: 'Retrieve a block',
      inputSchema: zodToJsonSchema(schemas.retrieveBlock),
    },
    {
      name: 'notion_update_block',
      description: 'Update a block',
      inputSchema: zodToJsonSchema(schemas.updateBlock),
    },
    {
      name: 'notion_delete_block',
      description: 'Delete a block',
      inputSchema: zodToJsonSchema(schemas.deleteBlock),
    },
    {
      name: 'notion_get_block_children',
      description: 'Get block children',
      inputSchema: zodToJsonSchema(schemas.getBlockChildren),
    },
    {
      name: 'notion_append_block_children',
      description: 'Append block children',
      inputSchema: zodToJsonSchema(schemas.appendBlockChildren),
    },

    // Search & User tools (4)
    {
      name: 'notion_search',
      description: 'Search pages and databases',
      inputSchema: zodToJsonSchema(schemas.search),
    },
    {
      name: 'notion_get_user',
      description: 'Retrieve a user',
      inputSchema: zodToJsonSchema(schemas.getUser),
    },
    {
      name: 'notion_list_users',
      description: 'List all users',
      inputSchema: zodToJsonSchema(schemas.listUsers),
    },
    {
      name: 'notion_get_me',
      description: 'Get current bot user',
      inputSchema: zodToJsonSchema(schemas.getMe),
    },

    // Comment tools (2)
    {
      name: 'notion_create_comment',
      description: 'Create a comment',
      inputSchema: zodToJsonSchema(schemas.createComment),
    },
    {
      name: 'notion_get_comments',
      description: 'Get comments',
      inputSchema: zodToJsonSchema(schemas.getComments),
    },
  ];
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  await initializeClient(config);

  try {
    switch (name) {
      // PAGE HANDLERS
      case 'notion_create_page': {
        const { page, parent, icon, cover } = schemas.createPage.parse(args);
        const res = await notionClient.post('/pages', {
          parent: parent || { workspace: true },
          properties: { title: { title: [{ text: { content: page.properties.title } }] } },
          children: page.content
            ? [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: { rich_text: [{ text: { content: page.content } }] },
                },
              ]
            : undefined,
          icon,
          cover,
        });
        return {
          content: [
            { type: 'text', text: `Page created!\nID: ${res.data.id}\nURL: ${res.data.url}` },
          ],
        };
      }

      case 'notion_get_page': {
        const { page_id, filter_properties } = schemas.getPage.parse(args);
        const res = await notionClient.get(`/pages/${page_id}`, {
          params: filter_properties ? { filter_properties: filter_properties.join(',') } : {},
        });

        // Extract title from properties
        const properties = res.data.properties || {};
        let title = 'Untitled';
        for (const key of Object.keys(properties)) {
          const prop = properties[key];
          if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
            title = prop.title[0].plain_text;
            break;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Page Details:\nID: ${res.data.id}\nTitle: ${title}\nURL: ${res.data.url}\nCreated: ${res.data.created_time}\nLast edited: ${res.data.last_edited_time}`,
            },
          ],
        };
      }

      case 'notion_update_page_properties': {
        const { page_id, ...updates } = schemas.updatePage.parse(args);
        await notionClient.patch(`/pages/${page_id}`, updates);
        return { content: [{ type: 'text', text: `Page ${page_id} updated` }] };
      }

      case 'notion_retrieve_page_property': {
        const { page_id, property_id, ...params } = schemas.retrievePageProperty.parse(args);
        const res = await notionClient.get(`/pages/${page_id}/properties/${property_id}`, {
          params,
        });
        return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
      }

      // DATABASE HANDLERS
      case 'notion_query_database': {
        const { database_id, ...query } = schemas.queryDatabase.parse(args);
        const res = await notionClient.post(`/databases/${database_id}/query`, query);
        const results = res.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No items found' }] };
        }

        const formatted = results
          .map((item: any) => {
            const title =
              item.properties?.Name?.title?.[0]?.plain_text ||
              item.properties?.Title?.title?.[0]?.plain_text ||
              'Untitled';
            return `ID: ${item.id}\nTitle: ${title}\nURL: ${item.url}\nCreated: ${item.created_time}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} items:\n\n${formatted}` }],
        };
      }

      case 'notion_get_database': {
        const { database_id } = schemas.getDatabase.parse(args);
        const res = await notionClient.get(`/databases/${database_id}`);
        const title = res.data.title?.[0]?.plain_text || 'Untitled';
        const propertyCount = Object.keys(res.data.properties || {}).length;

        return {
          content: [
            {
              type: 'text',
              text: `Database: ${title}\nID: ${res.data.id}\nURL: ${res.data.url}\nProperties: ${propertyCount}\nCreated: ${res.data.created_time}\nLast edited: ${res.data.last_edited_time}`,
            },
          ],
        };
      }

      case 'notion_create_database': {
        const data = schemas.createDatabase.parse(args);
        const res = await notionClient.post('/databases', data);
        const title = res.data.title?.[0]?.plain_text || 'Untitled';
        return {
          content: [
            {
              type: 'text',
              text: `Database created!\nID: ${res.data.id}\nTitle: ${title}\nURL: ${res.data.url}`,
            },
          ],
        };
      }

      case 'notion_update_database': {
        const { database_id, ...updates } = schemas.updateDatabase.parse(args);
        await notionClient.patch(`/databases/${database_id}`, updates);
        return { content: [{ type: 'text', text: `Database ${database_id} updated` }] };
      }

      case 'notion_create_database_item': {
        const { database_id, properties, children } = schemas.createDatabaseItem.parse(args);
        const res = await notionClient.post('/pages', {
          parent: { database_id },
          properties,
          children,
        });

        // Extract title from properties
        let title = 'Untitled';
        for (const key of Object.keys(res.data.properties || {})) {
          const prop = res.data.properties[key];
          if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
            title = prop.title[0].plain_text;
            break;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Item created!\nID: ${res.data.id}\nTitle: ${title}\nURL: ${res.data.url}`,
            },
          ],
        };
      }

      // BLOCK HANDLERS
      case 'notion_retrieve_block': {
        const { block_id } = schemas.retrieveBlock.parse(args);
        const res = await notionClient.get(`/blocks/${block_id}`);
        return {
          content: [{ type: 'text', text: `Block type: ${res.data.type}\nID: ${res.data.id}` }],
        };
      }

      case 'notion_update_block': {
        const { block_id, ...updates } = schemas.updateBlock.parse(args);
        await notionClient.patch(`/blocks/${block_id}`, updates);
        return { content: [{ type: 'text', text: `Block ${block_id} updated` }] };
      }

      case 'notion_delete_block': {
        const { block_id } = schemas.deleteBlock.parse(args);
        await notionClient.delete(`/blocks/${block_id}`);
        return { content: [{ type: 'text', text: `Block ${block_id} deleted` }] };
      }

      case 'notion_get_block_children': {
        const { block_id, ...params } = schemas.getBlockChildren.parse(args);
        const res = await notionClient.get(`/blocks/${block_id}/children`, { params });
        const results = res.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No children blocks found' }] };
        }

        const formatted = results
          .map((block: any) => {
            return `Type: ${block.type}\nID: ${block.id}\nCreated: ${block.created_time}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} children:\n\n${formatted}` }],
        };
      }

      case 'notion_append_block_children': {
        const { block_id, children, after } = schemas.appendBlockChildren.parse(args);
        await notionClient.patch(`/blocks/${block_id}/children`, { children, after });
        return { content: [{ type: 'text', text: `Appended ${children.length} children` }] };
      }

      // SEARCH & USER HANDLERS
      case 'notion_search': {
        const query = schemas.search.parse(args);
        const res = await notionClient.post('/search', query);
        const results = res.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found' }] };
        }

        const formatted = results
          .map((item: any) => {
            const type = item.object; // 'page' or 'database'
            let title = 'Untitled';

            if (type === 'page') {
              title =
                item.properties?.title?.title?.[0]?.plain_text ||
                item.properties?.Name?.title?.[0]?.plain_text ||
                item.properties?.Title?.title?.[0]?.plain_text ||
                'Untitled';
            } else if (type === 'database') {
              title = item.title?.[0]?.plain_text || 'Untitled';
            }

            return `Type: ${type}\nID: ${item.id}\nTitle: ${title}\nURL: ${item.url}\nLast edited: ${item.last_edited_time}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} results:\n\n${formatted}` }],
        };
      }

      case 'notion_get_user': {
        const { user_id } = schemas.getUser.parse(args);
        const res = await notionClient.get(`/users/${user_id}`);
        return {
          content: [
            { type: 'text', text: `User: ${res.data.name || 'Unknown'}\nID: ${res.data.id}` },
          ],
        };
      }

      case 'notion_list_users': {
        const params = schemas.listUsers.parse(args);
        const res = await notionClient.get('/users', { params });
        const results = res.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No users found' }] };
        }

        const formatted = results
          .map((user: any) => {
            const userType = user.type || 'unknown';
            const name = user.name || 'Unknown';
            return `Name: ${name}\nID: ${user.id}\nType: ${userType}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} users:\n\n${formatted}` }],
        };
      }

      case 'notion_get_me': {
        schemas.getMe.parse(args);
        const res = await notionClient.get('/users/me');
        return {
          content: [
            { type: 'text', text: `Bot: ${res.data.name || 'Unknown'}\nID: ${res.data.id}` },
          ],
        };
      }

      // COMMENT HANDLERS
      case 'notion_create_comment': {
        const data = schemas.createComment.parse(args);
        const res = await notionClient.post('/comments', data);
        return { content: [{ type: 'text', text: `Comment created! ID: ${res.data.id}` }] };
      }

      case 'notion_get_comments': {
        const { block_id, ...params } = schemas.getComments.parse(args);
        const res = await notionClient.get('/comments', { params: { block_id, ...params } });
        const results = res.data.results || [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No comments found' }] };
        }

        const formatted = results
          .map((comment: any) => {
            const text = comment.rich_text?.[0]?.plain_text || 'No content';
            const author = comment.created_by?.name || 'Unknown';
            return `ID: ${comment.id}\nAuthor: ${author}\nCreated: ${comment.created_time}\nText: ${text}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} comments:\n\n${formatted}` }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.response?.data?.message || error.message}` }],
    };
  }
}
