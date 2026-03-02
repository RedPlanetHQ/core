/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { callGranolaToolRPC } from '../utils';

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListMeetingsSchema = z.object({
  after: z.string().optional().describe('Return meetings after this ISO 8601 timestamp'),
  before: z.string().optional().describe('Return meetings before this ISO 8601 timestamp'),
  limit: z.number().optional().describe('Max number of meetings to return'),
});

const GetMeetingsSchema = z.object({
  query: z.string().optional().describe('Search keyword to filter meeting notes by content'),
  after: z.string().optional().describe('Filter meetings after this ISO 8601 timestamp'),
  before: z.string().optional().describe('Filter meetings before this ISO 8601 timestamp'),
  limit: z.number().optional().describe('Max number of meetings to return'),
});

const GetMeetingTranscriptSchema = z.object({
  meeting_id: z.string().describe('The Granola meeting ID to retrieve transcript for'),
});

const QueryMeetingsSchema = z.object({
  query: z.string().describe('Natural language question to ask across your meeting notes'),
});

// ─── Tool Definitions ────────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'granola_list_meetings',
      description: 'List Granola meeting notes with optional date filters. Returns meeting metadata including title, date, and attendees.',
      inputSchema: zodToJsonSchema(ListMeetingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'granola_get_meetings',
      description: 'Search Granola meeting notes by keyword or date range. Returns full meeting details and enhanced notes.',
      inputSchema: zodToJsonSchema(GetMeetingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'granola_get_meeting_transcript',
      description: 'Get the raw transcript for a specific Granola meeting by ID. Requires a paid Granola plan.',
      inputSchema: zodToJsonSchema(GetMeetingTranscriptSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'granola_query_meetings',
      description: 'Ask a natural language question across all your Granola meeting notes. Returns an AI-generated answer based on your meetings.',
      inputSchema: zodToJsonSchema(QueryMeetingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>,
) {
  try {
    switch (name) {
      case 'granola_list_meetings': {
        const params = ListMeetingsSchema.parse(args);
        const result = await callGranolaToolRPC(config, 'list_meetings', params);
        const text = result?.content?.map((c: any) => c.text).join('\n') ?? 'No meetings found.';
        return { content: [{ type: 'text', text }] };
      }

      case 'granola_get_meetings': {
        const params = GetMeetingsSchema.parse(args);
        const result = await callGranolaToolRPC(config, 'get_meetings', params);
        const text = result?.content?.map((c: any) => c.text).join('\n') ?? 'No meetings found.';
        return { content: [{ type: 'text', text }] };
      }

      case 'granola_get_meeting_transcript': {
        const { meeting_id } = GetMeetingTranscriptSchema.parse(args);
        const result = await callGranolaToolRPC(config, 'get_meeting_transcript', { meeting_id });
        const text = result?.content?.map((c: any) => c.text).join('\n') ?? 'No transcript available.';
        return { content: [{ type: 'text', text }] };
      }

      case 'granola_query_meetings': {
        const { query } = QueryMeetingsSchema.parse(args);
        const result = await callGranolaToolRPC(config, 'query_granola_meetings', { query });
        const text = result?.content?.map((c: any) => c.text).join('\n') ?? 'No results.';
        return { content: [{ type: 'text', text }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message;
    return { content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}
