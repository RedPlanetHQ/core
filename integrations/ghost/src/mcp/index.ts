/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getAuthHeaders } from '../utils';

let ghostClient: AxiosInstance;

function initializeClient(config: Record<string, string>) {
  ghostClient = axios.create({
    baseURL: `${config.ghost_url}/ghost/api/admin`,
    headers: {
      ...getAuthHeaders(config.admin_api_key),
      'Accept-Version': 'v5.0',
    },
  });
}

// ─── Tool Schemas ──────────────────────────────────────────────────────────

const ListPostsSchema = z.object({
  limit: z.number().optional().default(15).describe('Number of posts to return (max 100)'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
  status: z
    .enum(['published', 'draft', 'scheduled', 'all'])
    .optional()
    .default('all')
    .describe('Filter posts by status'),
  order: z.string().optional().describe('Sort order, e.g. "published_at desc"'),
});

const GetPostSchema = z.object({
  post_id: z.string().describe('The ID of the post to retrieve'),
});

const CreatePostSchema = z.object({
  title: z.string().describe('Post title'),
  html: z.string().optional().describe('Post body HTML content'),
  status: z
    .enum(['published', 'draft', 'scheduled'])
    .optional()
    .default('draft')
    .describe('Post status'),
  tags: z
    .array(z.object({ name: z.string() }))
    .optional()
    .describe('Array of tag objects with a name field'),
  featured: z.boolean().optional().describe('Whether the post is featured'),
  custom_excerpt: z.string().optional().describe('Short excerpt for the post'),
});

const UpdatePostSchema = z.object({
  post_id: z.string().describe('The ID of the post to update'),
  updated_at: z
    .string()
    .describe('Current updated_at timestamp of the post (required by Ghost API)'),
  title: z.string().optional().describe('New post title'),
  html: z.string().optional().describe('New post body HTML content'),
  status: z.enum(['published', 'draft', 'scheduled']).optional().describe('New post status'),
  tags: z
    .array(z.object({ name: z.string() }))
    .optional()
    .describe('Replacement tags array'),
  featured: z.boolean().optional().describe('Whether the post is featured'),
  custom_excerpt: z.string().optional().describe('Short excerpt for the post'),
});

const DeletePostSchema = z.object({
  post_id: z.string().describe('The ID of the post to delete'),
});

const ListPagesSchema = z.object({
  limit: z.number().optional().default(15).describe('Number of pages to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
  status: z
    .enum(['published', 'draft', 'all'])
    .optional()
    .default('all')
    .describe('Filter pages by status'),
});

const CreatePageSchema = z.object({
  title: z.string().describe('Page title'),
  html: z.string().optional().describe('Page body HTML content'),
  status: z.enum(['published', 'draft']).optional().default('draft').describe('Page status'),
  custom_excerpt: z.string().optional().describe('Short excerpt for the page'),
});

const UpdatePageSchema = z.object({
  page_id: z.string().describe('The ID of the page to update'),
  updated_at: z
    .string()
    .describe('Current updated_at timestamp of the page (required by Ghost API)'),
  title: z.string().optional().describe('New page title'),
  html: z.string().optional().describe('New page body HTML content'),
  status: z.enum(['published', 'draft']).optional().describe('New page status'),
  custom_excerpt: z.string().optional().describe('Short excerpt for the page'),
});

const ListTagsSchema = z.object({
  limit: z.number().optional().default(50).describe('Number of tags to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
});

const CreateTagSchema = z.object({
  name: z.string().describe('Tag name'),
  slug: z.string().optional().describe('URL slug for the tag'),
  description: z.string().optional().describe('Tag description'),
});

const ListMembersSchema = z.object({
  limit: z.number().optional().default(15).describe('Number of members to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
  filter: z.string().optional().describe('NQL filter string, e.g. "status:free"'),
  order: z.string().optional().describe('Sort order, e.g. "created_at desc"'),
});

const GetSiteSchema = z.object({});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'ghost_list_posts',
      description: 'List posts from Ghost blog with optional filtering and pagination.',
      inputSchema: zodToJsonSchema(ListPostsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_get_post',
      description: 'Get a single post by its ID.',
      inputSchema: zodToJsonSchema(GetPostSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_create_post',
      description: 'Create a new post in Ghost blog.',
      inputSchema: zodToJsonSchema(CreatePostSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ghost_update_post',
      description: 'Update an existing post. Requires the current updated_at timestamp.',
      inputSchema: zodToJsonSchema(UpdatePostSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_delete_post',
      description: 'Delete a post by its ID.',
      inputSchema: zodToJsonSchema(DeletePostSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'ghost_list_pages',
      description: 'List static pages from Ghost blog.',
      inputSchema: zodToJsonSchema(ListPagesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_create_page',
      description: 'Create a new static page in Ghost blog.',
      inputSchema: zodToJsonSchema(CreatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ghost_update_page',
      description: 'Update an existing static page. Requires the current updated_at timestamp.',
      inputSchema: zodToJsonSchema(UpdatePageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_list_tags',
      description: 'List all tags in Ghost blog.',
      inputSchema: zodToJsonSchema(ListTagsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_create_tag',
      description: 'Create a new tag in Ghost blog.',
      inputSchema: zodToJsonSchema(CreateTagSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'ghost_list_members',
      description: 'List members/subscribers of the Ghost blog.',
      inputSchema: zodToJsonSchema(ListMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'ghost_get_site',
      description: 'Get site settings and information for the Ghost blog.',
      inputSchema: zodToJsonSchema(GetSiteSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>
) {
  initializeClient(config);

  try {
    switch (name) {
      case 'ghost_list_posts': {
        const { limit, page, status, order } = ListPostsSchema.parse(args);
        const params: Record<string, any> = { limit, page };
        if (status !== 'all') params.filter = `status:${status}`;
        if (order) params.order = order;

        const response = await ghostClient.get('/posts/', { params });
        const posts = response.data.posts || [];
        const meta = response.data.meta?.pagination;

        if (posts.length === 0) {
          return { content: [{ type: 'text', text: 'No posts found.' }] };
        }

        const list = posts
          .map(
            (p: any) =>
              `ID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nSlug: ${p.slug}\nPublished: ${p.published_at || 'N/A'}\nURL: ${p.url}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${posts.length} posts (page ${meta?.page}/${meta?.pages}):\n\n${list}`,
            },
          ],
        };
      }

      case 'ghost_get_post': {
        const { post_id } = GetPostSchema.parse(args);
        const response = await ghostClient.get(`/posts/${post_id}/`);
        const p = response.data.posts[0];

        return {
          content: [
            {
              type: 'text',
              text: `Post Details:\nID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nSlug: ${p.slug}\nPublished: ${p.published_at || 'N/A'}\nUpdated: ${p.updated_at}\nExcerpt: ${p.custom_excerpt || 'N/A'}\nURL: ${p.url}`,
            },
          ],
        };
      }

      case 'ghost_create_post': {
        const { title, html, status, tags, featured, custom_excerpt } =
          CreatePostSchema.parse(args);
        const postData: Record<string, any> = { title, status };
        if (html) {
          postData.html = html;
          postData.source = 'html';
        }
        if (tags) postData.tags = tags;
        if (featured !== undefined) postData.featured = featured;
        if (custom_excerpt) postData.custom_excerpt = custom_excerpt;

        const response = await ghostClient.post('/posts/', { posts: [postData] });
        const p = response.data.posts[0];

        return {
          content: [
            {
              type: 'text',
              text: `Post created!\nID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nURL: ${p.url}`,
            },
          ],
        };
      }

      case 'ghost_update_post': {
        const { post_id, updated_at, ...updates } = UpdatePostSchema.parse(args);
        const postData: Record<string, any> = { ...updates, updated_at };
        if (updates.html) {
          postData.source = 'html';
        }
        const response = await ghostClient.put(`/posts/${post_id}/`, {
          posts: [postData],
        });
        const p = response.data.posts[0];

        return {
          content: [
            {
              type: 'text',
              text: `Post updated!\nID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nURL: ${p.url}`,
            },
          ],
        };
      }

      case 'ghost_delete_post': {
        const { post_id } = DeletePostSchema.parse(args);
        await ghostClient.delete(`/posts/${post_id}/`);

        return {
          content: [{ type: 'text', text: `Post ${post_id} deleted successfully.` }],
        };
      }

      case 'ghost_list_pages': {
        const { limit, page, status } = ListPagesSchema.parse(args);
        const params: Record<string, any> = { limit, page };
        if (status !== 'all') params.filter = `status:${status}`;

        const response = await ghostClient.get('/pages/', { params });
        const pages = response.data.pages || [];

        if (pages.length === 0) {
          return { content: [{ type: 'text', text: 'No pages found.' }] };
        }

        const list = pages
          .map(
            (p: any) =>
              `ID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nSlug: ${p.slug}\nURL: ${p.url}`
          )
          .join('\n\n');

        return { content: [{ type: 'text', text: `Found ${pages.length} pages:\n\n${list}` }] };
      }

      case 'ghost_create_page': {
        const { title, html, status, custom_excerpt } = CreatePageSchema.parse(args);
        const pageData: Record<string, any> = { title, status };
        if (html) {
          pageData.html = html;
          pageData.source = 'html';
        }
        if (custom_excerpt) pageData.custom_excerpt = custom_excerpt;

        const response = await ghostClient.post('/pages/', { pages: [pageData] });
        const p = response.data.pages[0];

        return {
          content: [
            {
              type: 'text',
              text: `Page created!\nID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nURL: ${p.url}`,
            },
          ],
        };
      }

      case 'ghost_update_page': {
        const { page_id, updated_at, ...updates } = UpdatePageSchema.parse(args);
        const pageData: Record<string, any> = { ...updates, updated_at };
        if (updates.html) {
          pageData.source = 'html';
        }
        const response = await ghostClient.put(`/pages/${page_id}/`, {
          pages: [pageData],
        });
        const p = response.data.pages[0];

        return {
          content: [
            {
              type: 'text',
              text: `Page updated!\nID: ${p.id}\nTitle: ${p.title}\nStatus: ${p.status}\nURL: ${p.url}`,
            },
          ],
        };
      }

      case 'ghost_list_tags': {
        const { limit, page } = ListTagsSchema.parse(args);
        const response = await ghostClient.get('/tags/', { params: { limit, page } });
        const tags = response.data.tags || [];

        if (tags.length === 0) {
          return { content: [{ type: 'text', text: 'No tags found.' }] };
        }

        const list = tags
          .map(
            (t: any) =>
              `ID: ${t.id}\nName: ${t.name}\nSlug: ${t.slug}\nPosts: ${t.count?.posts ?? 'N/A'}`
          )
          .join('\n\n');

        return { content: [{ type: 'text', text: `Found ${tags.length} tags:\n\n${list}` }] };
      }

      case 'ghost_create_tag': {
        const { name, slug, description } = CreateTagSchema.parse(args);
        const tagData: Record<string, any> = { name };
        if (slug) tagData.slug = slug;
        if (description) tagData.description = description;

        const response = await ghostClient.post('/tags/', { tags: [tagData] });
        const t = response.data.tags[0];

        return {
          content: [
            { type: 'text', text: `Tag created!\nID: ${t.id}\nName: ${t.name}\nSlug: ${t.slug}` },
          ],
        };
      }

      case 'ghost_list_members': {
        const { limit, page, filter, order } = ListMembersSchema.parse(args);
        const params: Record<string, any> = { limit, page };
        if (filter) params.filter = filter;
        if (order) params.order = order;

        const response = await ghostClient.get('/members/', { params });
        const members = response.data.members || [];
        const meta = response.data.meta?.pagination;

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No members found.' }] };
        }

        const list = members
          .map(
            (m: any) =>
              `Name: ${m.name || 'N/A'}\nEmail: ${m.email}\nStatus: ${m.status}\nCreated: ${m.created_at}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${members.length} members (page ${meta?.page}/${meta?.pages}):\n\n${list}`,
            },
          ],
        };
      }

      case 'ghost_get_site': {
        GetSiteSchema.parse(args);
        const response = await ghostClient.get('/site/');
        const site = response.data.site;

        return {
          content: [
            {
              type: 'text',
              text: `Site Info:\nTitle: ${site.title}\nDescription: ${site.description || 'N/A'}\nURL: ${site.url}\nVersion: ${site.version}\nTimezone: ${site.timezone || 'N/A'}`,
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
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    };
  }
}
