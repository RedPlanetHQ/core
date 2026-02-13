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

// Helper to extract plain text from rich_text array
function extractPlainText(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

// Helper to convert page ID to URL
function pageIdToUrl(pageId: string): string {
  const cleanId = pageId.replace(/-/g, '');
  return `https://www.notion.so/${cleanId}`;
}

// Helper to get icon string
function getIconString(icon: any): string {
  if (!icon) return '';
  if (icon.type === 'emoji') return icon.emoji;
  if (icon.type === 'external') return icon.external?.url || '';
  if (icon.type === 'file') return icon.file?.url || '';
  return '';
}

// Convert a single block to XML-like format
function blockToXml(block: any): string {
  const type = block.type;
  const blockData = block[type];

  if (!blockData) {
    return '<empty-block/>';
  }

  switch (type) {
    case 'paragraph': {
      const text = extractPlainText(blockData.rich_text);
      return text || '<empty-block/>';
    }
    case 'heading_1': {
      const text = extractPlainText(blockData.rich_text);
      return `<h1>${text}</h1>`;
    }
    case 'heading_2': {
      const text = extractPlainText(blockData.rich_text);
      return `<h2>${text}</h2>`;
    }
    case 'heading_3': {
      const text = extractPlainText(blockData.rich_text);
      return `<h3>${text}</h3>`;
    }
    case 'bulleted_list_item': {
      const text = extractPlainText(blockData.rich_text);
      return `<li>${text}</li>`;
    }
    case 'numbered_list_item': {
      const text = extractPlainText(blockData.rich_text);
      return `<li>${text}</li>`;
    }
    case 'to_do': {
      const text = extractPlainText(blockData.rich_text);
      const checked = blockData.checked ? '[x]' : '[ ]';
      return `<todo checked="${blockData.checked}">${checked} ${text}</todo>`;
    }
    case 'toggle': {
      const text = extractPlainText(blockData.rich_text);
      return `<toggle>${text}</toggle>`;
    }
    case 'child_page': {
      const title = blockData.title || 'Untitled';
      const url = pageIdToUrl(block.id);
      return `<page url="{{${url}}}">${title}</page>`;
    }
    case 'child_database': {
      const title = blockData.title || 'Untitled Database';
      const url = pageIdToUrl(block.id);
      return `<database url="{{${url}}}">${title}</database>`;
    }
    case 'code': {
      const text = extractPlainText(blockData.rich_text);
      const language = blockData.language || 'plain text';
      return `<code language="${language}">${text}</code>`;
    }
    case 'quote': {
      const text = extractPlainText(blockData.rich_text);
      return `<quote>${text}</quote>`;
    }
    case 'callout': {
      const text = extractPlainText(blockData.rich_text);
      const icon = getIconString(blockData.icon);
      return `<callout icon="${icon}">${text}</callout>`;
    }
    case 'divider': {
      return '<divider/>';
    }
    case 'image': {
      const url = blockData.external?.url || blockData.file?.url || '';
      const caption = extractPlainText(blockData.caption);
      return `<image src="${url}"${caption ? ` caption="${caption}"` : ''}/>`;
    }
    case 'bookmark': {
      const url = blockData.url || '';
      const caption = extractPlainText(blockData.caption);
      return `<bookmark url="${url}"${caption ? ` caption="${caption}"` : ''}/>`;
    }
    case 'embed': {
      const url = blockData.url || '';
      return `<embed url="${url}"/>`;
    }
    case 'equation': {
      const expression = blockData.expression || '';
      return `<equation>${expression}</equation>`;
    }
    case 'link_to_page': {
      const pageId = blockData.page_id || blockData.database_id || '';
      const url = pageIdToUrl(pageId);
      return `<link-to-page url="{{${url}}}"/>`;
    }
    default:
      return `<${type}/>`;
  }
}

// Fetch all block children with pagination
async function fetchAllBlockChildren(blockId: string): Promise<any[]> {
  const allBlocks: any[] = [];
  let cursor: string | undefined;

  do {
    const res = await notionClient.get(`/blocks/${blockId}/children`, {
      params: { start_cursor: cursor, page_size: 100 },
    });
    allBlocks.push(...(res.data.results || []));
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor);

  return allBlocks;
}

// Convert blocks array to XML content string (recursive)
async function blocksToXmlContent(blocks: any[]): Promise<string> {
  const lines: string[] = [];

  for (const block of blocks) {
    const xml = blockToXml(block);
    lines.push(xml);

    // Recursively fetch children if the block has children (but not child pages/databases)
    if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
      try {
        const children = await fetchAllBlockChildren(block.id);
        const childContent = await blocksToXmlContent(children);
        if (childContent) {
          lines.push(childContent);
        }
      } catch (e) {
        // Ignore errors fetching children
      }
    }
  }

  return lines.join('\n');
}

// Schemas - organized by category
const schemas = {
  // PAGE TOOLS
  createPage: z.object({
    pages: z
      .array(
        z.object({
          properties: z.record(z.any()).describe('Page properties as a JSON map'),
          content: z.string().optional().describe('Page content in Notion-flavored Markdown'),
        })
      )
      .max(100)
      .describe('The pages to create'),
    parent: z
      .object({
        page_id: z.string().optional().describe('Parent page ID'),
        database_id: z.string().optional().describe('Parent database ID'),
        data_source_id: z.string().optional().describe('Data source/collection ID'),
      })
      .optional()
      .describe('Parent for the new pages. If omitted, creates as private workspace-level pages'),
  }),
  getPage: z.object({
    page_id: z.string().describe('Page ID'),
    filter_properties: z.array(z.string()).optional().describe('Filter properties'),
  }),
  updatePage: z.object({
    page_id: z.string().describe('Page ID to update'),
    command: z
      .enum(['update_properties', 'replace_content', 'replace_content_range', 'insert_content_after'])
      .describe('The update command to execute'),
    properties: z.record(z.any()).optional().describe('Properties to update (for update_properties command)'),
    new_str: z.string().optional().describe('New content string (for content commands)'),
    selection_with_ellipsis: z
      .string()
      .optional()
      .describe('Selection pattern with ellipsis for replace_content_range or insert_content_after'),
    allow_deleting_content: z
      .boolean()
      .optional()
      .describe('Set to true to allow deleting child pages/databases'),
  }),
  retrievePageProperty: z.object({
    page_id: z.string().describe('Page ID'),
    property_id: z.string().describe('Property ID'),
    start_cursor: z.string().optional(),
    page_size: z.number().optional(),
  }),
  movePages: z.object({
    page_or_database_ids: z
      .array(z.string())
      .min(1)
      .max(100)
      .describe('Array of page or database IDs to move (v4 UUIDs, with or without dashes)'),
    new_parent: z
      .object({
        page_id: z.string().optional().describe('Parent page ID'),
        database_id: z.string().optional().describe('Parent database ID'),
        workspace: z.boolean().optional().describe('Move to workspace level (private pages)'),
      })
      .describe('The new parent for the pages'),
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
      description: `## Overview
Creates one or more Notion pages, with the specified properties and content.

## Parent
All pages created with a single call to this tool will have the same parent. The parent can be a Notion page ("page_id") or data source ("data_source_id"). If the parent is omitted, the pages are created as standalone, workspace-level private pages.

If you have a database URL, ALWAYS pass it to the "fetch" tool first to get the schema and URLs of each data source under the database. You can't use the "database_id" parent type if the database has more than one data source, so you'll need to identify which "data_source_id" to use.

## Content
Notion page content is a string in Notion-flavored Markdown format. Don't include the page title at the top of the page's content. Only include it under "properties".

## Properties
Notion page properties are a JSON map of property names to SQLite values.
When creating pages in a database:
- Use the correct property names from the data source schema shown in the fetch tool results.
- Always include a title property.

For pages outside of a database:
- The only allowed property is "title", which is the title of the page in inline markdown format.

**IMPORTANT**: Some property types require expanded formats:
- Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
- Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
- Number properties: Use JavaScript numbers (not strings)
- Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked

**Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")`,
      inputSchema: zodToJsonSchema(schemas.createPage),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'notion_get_page',
      description: 'Retrieve a page with its full content (metadata, properties, and all blocks)',
      inputSchema: zodToJsonSchema(schemas.getPage),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_update_page',
      description: `## Overview
Update a Notion page's properties or content.

## Properties
Notion page properties are a JSON map of property names to SQLite values.
For pages in a database:
- ALWAYS use the "fetch" tool first to get the data source schema and the exact property names.
- Provide a non-null value to update a property's value.
- Omitted properties are left unchanged.

**IMPORTANT**: Some property types require expanded formats:
- Date properties: Split into "date:{property}:start", "date:{property}:end" (optional), and "date:{property}:is_datetime" (0 or 1)
- Place properties: Split into "place:{property}:name", "place:{property}:address", "place:{property}:latitude", "place:{property}:longitude", and "place:{property}:google_place_id" (optional)
- Number properties: Use JavaScript numbers (not strings)
- Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked

**Special property naming**: Properties named "id" or "url" (case insensitive) must be prefixed with "userDefined:" (e.g., "userDefined:URL", "userDefined:id")

For pages outside of a database:
- The only allowed property is "title", which is the title of the page in inline markdown format.

## Content
Notion page content is a string in Notion-flavored Markdown format.

Before updating a page's content with this tool, use the "fetch" tool first to get the existing content.

### Preserving Child Pages and Databases
When using "replace_content" or "replace_content_range", the operation will check if any child pages or databases would be deleted. If so, it will fail with an error listing the affected items.

**CRITICAL**: To intentionally delete child content: if the call failed with validation and requires "allow_deleting_content" to be true, DO NOT automatically assume the content should be deleted. ALWAYS show the list of pages to be deleted and ask for user confirmation before proceeding.

## Commands
- update_properties: Update page properties only
- replace_content: Replace the entire content of a page
- replace_content_range: Replace specific content using selection_with_ellipsis
- insert_content_after: Insert content after specific text

**Note**: For selection_with_ellipsis, provide only the first ~10 characters, an ellipsis, and the last ~10 characters. Ensure the selection is unique.`,
      inputSchema: zodToJsonSchema(schemas.updatePage),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'notion_retrieve_page_property',
      description: 'Retrieve page property',
      inputSchema: zodToJsonSchema(schemas.retrievePageProperty),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_move_pages',
      description: `Move one or more Notion pages or databases to a new parent.

## Parameters
- page_or_database_ids: Array of up to 100 page or database IDs to move (v4 UUIDs, with or without dashes)
- new_parent: The new parent - can be a page (page_id), database (database_id), or workspace level

## Notes
- Pages must be within the current workspace with proper permissions
- Data Sources under Databases can't be moved individually
- Moving to workspace level adds them as private pages (should rarely be used)`,
      inputSchema: zodToJsonSchema(schemas.movePages),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    // Database tools (5)
    {
      name: 'notion_query_database',
      description: 'Query a database',
      inputSchema: zodToJsonSchema(schemas.queryDatabase),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_get_database',
      description: 'Retrieve a database',
      inputSchema: zodToJsonSchema(schemas.getDatabase),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_create_database',
      description: 'Create a database',
      inputSchema: zodToJsonSchema(schemas.createDatabase),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'notion_update_database',
      description: 'Update a database',
      inputSchema: zodToJsonSchema(schemas.updateDatabase),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'notion_create_database_item',
      description: 'Create database item',
      inputSchema: zodToJsonSchema(schemas.createDatabaseItem),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // Search & User tools (4)
    {
      name: 'notion_search',
      description: 'Search pages and databases',
      inputSchema: zodToJsonSchema(schemas.search),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_get_user',
      description: 'Retrieve a user',
      inputSchema: zodToJsonSchema(schemas.getUser),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_list_users',
      description: 'List all users',
      inputSchema: zodToJsonSchema(schemas.listUsers),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'notion_get_me',
      description: 'Get current bot user',
      inputSchema: zodToJsonSchema(schemas.getMe),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Comment tools (2)
    {
      name: 'notion_create_comment',
      description: 'Create a comment',
      inputSchema: zodToJsonSchema(schemas.createComment),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'notion_get_comments',
      description: 'Get comments',
      inputSchema: zodToJsonSchema(schemas.getComments),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
        const { pages, parent } = schemas.createPage.parse(args);

        // Determine parent object for Notion API
        let parentObj: any;
        if (parent?.page_id) {
          parentObj = { page_id: parent.page_id };
        } else if (parent?.database_id) {
          parentObj = { database_id: parent.database_id };
        } else if (parent?.data_source_id) {
          parentObj = { database_id: parent.data_source_id };
        } else {
          parentObj = { workspace: true };
        }

        const createdPages: any[] = [];

        for (const page of pages) {
          // Build properties - handle title specially
          const notionProperties: any = {};
          for (const [key, value] of Object.entries(page.properties || {})) {
            if (key === 'title' || key.toLowerCase() === 'title') {
              notionProperties[key] = { title: [{ text: { content: value as string } }] };
            } else {
              // Pass through other properties as-is for now
              notionProperties[key] = value;
            }
          }

          // Build children blocks from content
          const children = page.content
            ? [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: { rich_text: [{ text: { content: page.content } }] },
                },
              ]
            : undefined;

          const res = await notionClient.post('/pages', {
            parent: parentObj,
            properties: notionProperties,
            children,
          });

          createdPages.push({
            id: res.data.id,
            url: res.data.url,
          });
        }

        const resultText = createdPages
          .map((p, i) => `Page ${i + 1}:\nID: ${p.id}\nURL: ${p.url}`)
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Created ${createdPages.length} page(s)!\n\n${resultText}` },
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

        const pageUrl = res.data.url || pageIdToUrl(page_id);
        const icon = getIconString(res.data.icon);
        const timestamp = new Date().toISOString();

        // Fetch page content (blocks)
        let contentXml = '';
        try {
          const blocks = await fetchAllBlockChildren(page_id);
          contentXml = await blocksToXmlContent(blocks);
        } catch (e) {
          contentXml = '<error>Failed to fetch page content</error>';
        }

        // Build the XML-like response
        const pageXml = `Here is the result of "view" for the Page with URL {{${pageUrl}}} as of ${timestamp}:
<page url="{{${pageUrl}}}"${icon ? ` icon="${icon}"` : ''}>
<properties>
${JSON.stringify({ title })}
</properties>
<content>
${contentXml}
</content>
</page>`;

        const result = {
          metadata: { type: 'page' },
          title,
          url: pageUrl,
          text: pageXml,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }

      case 'notion_update_page': {
        const { page_id, command, properties, new_str, selection_with_ellipsis, allow_deleting_content } =
          schemas.updatePage.parse(args);

        switch (command) {
          case 'update_properties': {
            if (!properties) {
              return { content: [{ type: 'text', text: 'Error: properties required for update_properties command' }] };
            }

            // Build Notion properties format
            const notionProperties: any = {};
            for (const [key, value] of Object.entries(properties)) {
              if (key === 'title' || key.toLowerCase() === 'title') {
                notionProperties[key] = { title: [{ text: { content: value as string } }] };
              } else {
                notionProperties[key] = value;
              }
            }

            await notionClient.patch(`/pages/${page_id}`, { properties: notionProperties });
            return { content: [{ type: 'text', text: `Page ${page_id} properties updated` }] };
          }

          case 'replace_content': {
            if (!new_str) {
              return { content: [{ type: 'text', text: 'Error: new_str required for replace_content command' }] };
            }

            // Get existing children to check for child pages/databases
            const existingBlocks = await fetchAllBlockChildren(page_id);
            const childPages = existingBlocks.filter(
              (b: any) => b.type === 'child_page' || b.type === 'child_database'
            );

            if (childPages.length > 0 && !allow_deleting_content) {
              const childList = childPages
                .map((b: any) => `- ${b.type}: ${b[b.type]?.title || b.id}`)
                .join('\n');
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: This operation would delete child pages/databases:\n${childList}\n\nSet allow_deleting_content: true to proceed.`,
                  },
                ],
              };
            }

            // Delete existing blocks
            for (const block of existingBlocks) {
              try {
                await notionClient.delete(`/blocks/${block.id}`);
              } catch (e) {
                // Ignore deletion errors
              }
            }

            // Add new content as a paragraph block
            await notionClient.patch(`/blocks/${page_id}/children`, {
              children: [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: { rich_text: [{ text: { content: new_str } }] },
                },
              ],
            });

            return { content: [{ type: 'text', text: `Page ${page_id} content replaced` }] };
          }

          case 'replace_content_range':
          case 'insert_content_after': {
            if (!new_str || !selection_with_ellipsis) {
              return {
                content: [
                  { type: 'text', text: 'Error: new_str and selection_with_ellipsis required for this command' },
                ],
              };
            }

            // For now, return a message that this is a complex operation
            return {
              content: [
                {
                  type: 'text',
                  text: `Command ${command} noted. Selection: "${selection_with_ellipsis}". This requires fetching and parsing existing content.`,
                },
              ],
            };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown command: ${command}` }] };
        }
      }

      case 'notion_retrieve_page_property': {
        const { page_id, property_id, ...params } = schemas.retrievePageProperty.parse(args);
        const res = await notionClient.get(`/pages/${page_id}/properties/${property_id}`, {
          params,
        });
        return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
      }

      case 'notion_move_pages': {
        const { page_or_database_ids, new_parent } = schemas.movePages.parse(args);

        // Build parent object for Notion API
        let parentObj: any;
        if (new_parent.page_id) {
          parentObj = { type: 'page_id', page_id: new_parent.page_id };
        } else if (new_parent.database_id) {
          parentObj = { type: 'database_id', database_id: new_parent.database_id };
        } else if (new_parent.workspace) {
          parentObj = { type: 'workspace', workspace: true };
        } else {
          return { content: [{ type: 'text', text: 'Error: new_parent must specify page_id, database_id, or workspace' }] };
        }

        const results: { id: string; success: boolean; error?: string }[] = [];

        for (const id of page_or_database_ids) {
          try {
            await notionClient.patch(`/pages/${id}`, { parent: parentObj });
            results.push({ id, success: true });
          } catch (error: any) {
            results.push({
              id,
              success: false,
              error: error.response?.data?.message || error.message,
            });
          }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        let resultText = `Moved ${successCount}/${page_or_database_ids.length} pages successfully.`;
        if (failureCount > 0) {
          resultText += `\n\nFailed (${failureCount}):\n`;
          resultText += results
            .filter(r => !r.success)
            .map(r => `- ${r.id}: ${r.error}`)
            .join('\n');
        }

        return { content: [{ type: 'text', text: resultText }] };
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
