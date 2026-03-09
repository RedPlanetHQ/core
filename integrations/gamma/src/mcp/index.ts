/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { gammaGet, gammaPost } from '../utils';

// ─── Tool Schemas ──────────────────────────────────────────────────────────

const ListPresentationsSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of presentations to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
});

const GetPresentationSchema = z.object({
  id: z.string().describe('The ID of the presentation to retrieve'),
});

const CreatePresentationSchema = z.object({
  prompt: z.string().describe('Text prompt to generate the presentation from'),
  title: z.string().optional().describe('Optional title for the presentation'),
});

const ListDocumentsSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of documents to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
});

const GetDocumentSchema = z.object({
  id: z.string().describe('The ID of the document to retrieve'),
});

const ListWebsitesSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of websites to return'),
  page: z.number().optional().default(1).describe('Page number for pagination'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'gamma_list_presentations',
      description: "List the user's Gamma presentations with optional pagination.",
      inputSchema: zodToJsonSchema(ListPresentationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'gamma_get_presentation',
      description: 'Get details of a specific Gamma presentation by ID.',
      inputSchema: zodToJsonSchema(GetPresentationSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'gamma_create_presentation',
      description: 'Generate a new Gamma presentation from a text prompt.',
      inputSchema: zodToJsonSchema(CreatePresentationSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'gamma_list_documents',
      description: "List the user's Gamma documents with optional pagination.",
      inputSchema: zodToJsonSchema(ListDocumentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'gamma_get_document',
      description: 'Get details of a specific Gamma document by ID.',
      inputSchema: zodToJsonSchema(GetDocumentSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'gamma_list_websites',
      description: "List the user's published Gamma websites with optional pagination.",
      inputSchema: zodToJsonSchema(ListWebsitesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function callTool(name: string, args: Record<string, any>, apiKey: string) {
  try {
    switch (name) {
      case 'gamma_list_presentations': {
        const { limit, page } = ListPresentationsSchema.parse(args);
        const data = await gammaGet('/presentations', apiKey, { limit, page });
        const items = data?.items || data?.presentations || data || [];

        if (!items.length) {
          return { content: [{ type: 'text', text: 'No presentations found.' }] };
        }

        const list = items
          .map(
            (p: any) =>
              `ID: ${p.id}\nTitle: ${p.title || p.name || 'Untitled'}\nUpdated: ${p.updatedAt || 'N/A'}\nURL: ${p.url || p.shareUrl || 'N/A'}`
          )
          .join('\n\n');

        return { content: [{ type: 'text', text: `Found ${items.length} presentations:\n\n${list}` }] };
      }

      case 'gamma_get_presentation': {
        const { id } = GetPresentationSchema.parse(args);
        const data = await gammaGet(`/presentations/${id}`, apiKey);
        const p = data?.presentation || data;

        return {
          content: [
            {
              type: 'text',
              text: `Presentation:\nID: ${p.id}\nTitle: ${p.title || p.name || 'Untitled'}\nUpdated: ${p.updatedAt || 'N/A'}\nURL: ${p.url || p.shareUrl || 'N/A'}`,
            },
          ],
        };
      }

      case 'gamma_create_presentation': {
        const { prompt, title } = CreatePresentationSchema.parse(args);
        const body: Record<string, any> = { prompt };
        if (title) body.title = title;

        const data = await gammaPost('/presentations/generate', apiKey, body);
        const p = data?.presentation || data;

        return {
          content: [
            {
              type: 'text',
              text: `Presentation created!\nID: ${p.id}\nTitle: ${p.title || p.name || 'Untitled'}\nURL: ${p.url || p.shareUrl || 'N/A'}`,
            },
          ],
        };
      }

      case 'gamma_list_documents': {
        const { limit, page } = ListDocumentsSchema.parse(args);
        const data = await gammaGet('/documents', apiKey, { limit, page });
        const items = data?.items || data?.documents || data || [];

        if (!items.length) {
          return { content: [{ type: 'text', text: 'No documents found.' }] };
        }

        const list = items
          .map(
            (d: any) =>
              `ID: ${d.id}\nTitle: ${d.title || d.name || 'Untitled'}\nUpdated: ${d.updatedAt || 'N/A'}\nURL: ${d.url || d.shareUrl || 'N/A'}`
          )
          .join('\n\n');

        return { content: [{ type: 'text', text: `Found ${items.length} documents:\n\n${list}` }] };
      }

      case 'gamma_get_document': {
        const { id } = GetDocumentSchema.parse(args);
        const data = await gammaGet(`/documents/${id}`, apiKey);
        const d = data?.document || data;

        return {
          content: [
            {
              type: 'text',
              text: `Document:\nID: ${d.id}\nTitle: ${d.title || d.name || 'Untitled'}\nUpdated: ${d.updatedAt || 'N/A'}\nURL: ${d.url || d.shareUrl || 'N/A'}`,
            },
          ],
        };
      }

      case 'gamma_list_websites': {
        const { limit, page } = ListWebsitesSchema.parse(args);
        const data = await gammaGet('/websites', apiKey, { limit, page });
        const items = data?.items || data?.websites || data || [];

        if (!items.length) {
          return { content: [{ type: 'text', text: 'No websites found.' }] };
        }

        const list = items
          .map(
            (w: any) =>
              `ID: ${w.id}\nTitle: ${w.title || w.name || 'Untitled'}\nUpdated: ${w.updatedAt || 'N/A'}\nURL: ${w.url || w.shareUrl || 'N/A'}`
          )
          .join('\n\n');

        return { content: [{ type: 'text', text: `Found ${items.length} websites:\n\n${list}` }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    return { content: [{ type: 'text', text: `Error: ${errorMessage}` }] };
  }
}
