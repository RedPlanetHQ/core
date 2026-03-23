/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { fathomDelete, fathomGet, fathomPost, fetchAllPages } from '../utils';

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListMeetingsSchema = z.object({
  limit: z.number().optional().describe('Max number of meetings to return (default 50)'),
  created_after: z
    .string()
    .optional()
    .describe('Filter meetings created after this date (ISO 8601)'),
  created_before: z
    .string()
    .optional()
    .describe('Filter meetings created before this date (ISO 8601)'),
  recorded_by: z.string().optional().describe('Filter by the email of the person who recorded'),
  include_transcript: z
    .boolean()
    .optional()
    .describe('Include transcript in response (default false)'),
});

const GetMeetingSchema = z.object({
  meeting_id: z.string().describe('The meeting ID'),
});

const GetMeetingTranscriptSchema = z.object({
  meeting_id: z.string().describe('The meeting ID'),
});

const GetMeetingSummarySchema = z.object({
  meeting_id: z.string().describe('The meeting ID'),
});

const GetRecordingSchema = z.object({
  recording_id: z.string().describe('The recording ID'),
});

const GetRecordingTranscriptSchema = z.object({
  recording_id: z.string().describe('The recording ID'),
});

const ListTeamsSchema = z.object({});

const ListTeamMembersSchema = z.object({
  team_id: z.string().describe('The team ID'),
});

const ListWebhooksSchema = z.object({});

const CreateWebhookSchema = z.object({
  url: z.string().describe('The webhook callback URL'),
  events: z
    .array(z.string())
    .describe('List of event types to subscribe to (e.g. meeting.completed)'),
});

const DeleteWebhookSchema = z.object({
  webhook_id: z.string().describe('The webhook ID to delete'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'fathom_list_meetings',
      description:
        'List meetings from Fathom with optional filters for date range, recorder, and transcript inclusion.',
      inputSchema: zodToJsonSchema(ListMeetingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_get_meeting',
      description: 'Get details of a specific Fathom meeting by ID.',
      inputSchema: zodToJsonSchema(GetMeetingSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_get_meeting_transcript',
      description:
        'Get the full transcript of a Fathom meeting with speaker diarization and timestamps.',
      inputSchema: zodToJsonSchema(GetMeetingTranscriptSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_get_meeting_summary',
      description:
        'Get the AI-generated summary of a Fathom meeting including key points and action items.',
      inputSchema: zodToJsonSchema(GetMeetingSummarySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_get_recording',
      description: 'Get details of a specific Fathom recording by ID.',
      inputSchema: zodToJsonSchema(GetRecordingSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_get_recording_transcript',
      description: 'Get the transcript of a specific Fathom recording.',
      inputSchema: zodToJsonSchema(GetRecordingTranscriptSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_list_teams',
      description: 'List all teams accessible with the current API key.',
      inputSchema: zodToJsonSchema(ListTeamsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_list_team_members',
      description: 'List members of a specific Fathom team.',
      inputSchema: zodToJsonSchema(ListTeamMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_list_webhooks',
      description: 'List all active webhook subscriptions.',
      inputSchema: zodToJsonSchema(ListWebhooksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fathom_create_webhook',
      description: 'Create a new webhook subscription for Fathom events.',
      inputSchema: zodToJsonSchema(CreateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'fathom_delete_webhook',
      description: 'Delete a webhook subscription by ID.',
      inputSchema: zodToJsonSchema(DeleteWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, string>,
) {
  try {
    switch (name) {
      case 'fathom_list_meetings': {
        const { limit, created_after, created_before, recorded_by, include_transcript } =
          ListMeetingsSchema.parse(args);

        const meetings = await fetchAllPages<any>(config.api_key, '/meetings', {
          limit: limit ?? 50,
          created_after,
          created_before,
          recorded_by,
          include_transcript,
        });

        if (meetings.length === 0) {
          return { content: [{ type: 'text', text: 'No meetings found.' }] };
        }

        const list = meetings
          .map((m: any) => {
            const parts = [`ID: ${m.id}`, `Title: ${m.title || 'Untitled'}`];
            if (m.created_at) parts.push(`Date: ${m.created_at}`);
            if (m.duration) parts.push(`Duration: ${Math.round(m.duration / 60)} min`);
            if (m.recorded_by) parts.push(`Recorded by: ${m.recorded_by}`);
            if (m.share_url) parts.push(`URL: ${m.share_url}`);
            return parts.join('\n');
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${meetings.length} meeting(s):\n\n${list}` }],
        };
      }

      case 'fathom_get_meeting': {
        const { meeting_id } = GetMeetingSchema.parse(args);
        const meeting = await fathomGet(config.api_key, `/meetings/${meeting_id}`);

        if (!meeting) {
          return { content: [{ type: 'text', text: `Meeting ${meeting_id} not found.` }] };
        }

        const parts = [
          `ID: ${meeting.id}`,
          `Title: ${meeting.title || 'Untitled'}`,
          `Date: ${meeting.created_at || 'N/A'}`,
          `Duration: ${meeting.duration ? `${Math.round(meeting.duration / 60)} min` : 'N/A'}`,
          `Recorded by: ${meeting.recorded_by || 'N/A'}`,
          `URL: ${meeting.share_url || 'N/A'}`,
        ];

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'fathom_get_meeting_transcript': {
        const { meeting_id } = GetMeetingTranscriptSchema.parse(args);
        const entries = await fetchAllPages<any>(
          config.api_key,
          `/meetings/${meeting_id}/transcript`,
        );

        if (entries.length === 0) {
          return { content: [{ type: 'text', text: 'Transcript is empty.' }] };
        }

        const text = entries
          .map((entry: any) => {
            const speaker = entry.speaker || 'Unknown';
            const time = entry.start_time != null ? formatTime(entry.start_time) : '?';
            return `[${time}] ${speaker}: ${entry.text || ''}`;
          })
          .join('\n');

        return { content: [{ type: 'text', text: `Transcript:\n\n${text}` }] };
      }

      case 'fathom_get_meeting_summary': {
        const { meeting_id } = GetMeetingSummarySchema.parse(args);
        const summary = await fathomGet(config.api_key, `/meetings/${meeting_id}/summary`);

        if (!summary) {
          return {
            content: [{ type: 'text', text: `Summary for meeting ${meeting_id} not found.` }],
          };
        }

        const parts = [];
        if (summary.key_points) parts.push(`Key points:\n${summary.key_points}`);
        if (summary.action_items) parts.push(`Action items:\n${summary.action_items}`);
        if (summary.highlights) parts.push(`Highlights:\n${summary.highlights}`);
        if (summary.overview) parts.push(`Overview:\n${summary.overview}`);

        if (parts.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
        }

        return { content: [{ type: 'text', text: parts.join('\n\n') }] };
      }

      case 'fathom_get_recording': {
        const { recording_id } = GetRecordingSchema.parse(args);
        const recording = await fathomGet(config.api_key, `/recordings/${recording_id}`);

        if (!recording) {
          return { content: [{ type: 'text', text: `Recording ${recording_id} not found.` }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(recording, null, 2) }] };
      }

      case 'fathom_get_recording_transcript': {
        const { recording_id } = GetRecordingTranscriptSchema.parse(args);
        const entries = await fetchAllPages<any>(
          config.api_key,
          `/recordings/${recording_id}/transcript`,
        );

        if (entries.length === 0) {
          return { content: [{ type: 'text', text: 'Transcript is empty.' }] };
        }

        const text = entries
          .map((entry: any) => {
            const speaker = entry.speaker || 'Unknown';
            const time = entry.start_time != null ? formatTime(entry.start_time) : '?';
            return `[${time}] ${speaker}: ${entry.text || ''}`;
          })
          .join('\n');

        return { content: [{ type: 'text', text: `Transcript:\n\n${text}` }] };
      }

      case 'fathom_list_teams': {
        const teams = await fathomGet(config.api_key, '/teams');
        const teamList = Array.isArray(teams) ? teams : teams?.data ?? [];

        if (teamList.length === 0) {
          return { content: [{ type: 'text', text: 'No teams found.' }] };
        }

        const list = teamList
          .map((t: any) => `ID: ${t.id}\nName: ${t.name || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${teamList.length} team(s):\n\n${list}` }],
        };
      }

      case 'fathom_list_team_members': {
        const { team_id } = ListTeamMembersSchema.parse(args);
        const memberList = await fetchAllPages<any>(config.api_key, `/teams/${team_id}/members`);

        if (memberList.length === 0) {
          return { content: [{ type: 'text', text: 'No team members found.' }] };
        }

        const list = memberList
          .map(
            (m: any) =>
              `${m.name || m.email || 'Unknown'} (${m.email || 'no email'}) — ${m.role || 'member'}`,
          )
          .join('\n');

        return {
          content: [
            { type: 'text', text: `Found ${memberList.length} member(s):\n\n${list}` },
          ],
        };
      }

      case 'fathom_list_webhooks': {
        const webhooks = await fathomGet(config.api_key, '/webhooks');
        const webhookList = Array.isArray(webhooks) ? webhooks : webhooks?.data ?? [];

        if (webhookList.length === 0) {
          return { content: [{ type: 'text', text: 'No webhooks found.' }] };
        }

        const list = webhookList
          .map(
            (w: any) => `ID: ${w.id}\nURL: ${w.url}\nEvents: ${(w.events || []).join(', ')}`,
          )
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${webhookList.length} webhook(s):\n\n${list}` },
          ],
        };
      }

      case 'fathom_create_webhook': {
        const { url, events } = CreateWebhookSchema.parse(args);
        const webhook = await fathomPost(config.api_key, '/webhooks', { url, events });

        return {
          content: [
            {
              type: 'text',
              text: `Webhook created.\nID: ${webhook.id}\nURL: ${webhook.url}\nEvents: ${(webhook.events || []).join(', ')}`,
            },
          ],
        };
      }

      case 'fathom_delete_webhook': {
        const { webhook_id } = DeleteWebhookSchema.parse(args);
        await fathomDelete(config.api_key, `/webhooks/${webhook_id}`);

        return {
          content: [{ type: 'text', text: `Webhook ${webhook_id} deleted.` }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${errorMessage}` }] };
  }
}

function formatTime(seconds: number): string {
  if (!seconds && seconds !== 0) return '?';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
