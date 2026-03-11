/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { callFirefliesAPI } from '../utils';

// ─── Schemas ────────────────────────────────────────────────────────────────

const GetUserSchema = z.object({});

const SearchTranscriptsSchema = z.object({
  limit: z.number().optional().describe('Max number of transcripts to return'),
  fromDate: z.string().optional().describe('Filter transcripts from this date (ISO 8601)'),
  toDate: z.string().optional().describe('Filter transcripts up to this date (ISO 8601)'),
  keyword: z.string().optional().describe('Search keyword to filter transcripts'),
  mine: z
    .boolean()
    .optional()
    .describe('If true, return only transcripts organized by the authenticated user'),
  organizers: z.array(z.string()).optional().describe('Filter by organizer email addresses'),
  participants: z.array(z.string()).optional().describe('Filter by participant email addresses'),
});

const GetTranscriptSchema = z.object({
  id: z.string().describe('The transcript ID'),
});

const GetActiveMeetingsSchema = z.object({
  states: z
    .array(z.enum(['in_call_not_recording', 'in_call_recording', 'in_call_paused']))
    .optional()
    .describe('Filter by meeting state(s)'),
});

const AskFredSchema = z.object({
  query: z.string().describe('Natural language question to ask about meetings'),
  transcript_id: z.string().optional().describe('Ask about a specific transcript by ID'),
  fromDate: z.string().optional().describe('Filter context to meetings from this date (ISO 8601)'),
  toDate: z.string().optional().describe('Filter context to meetings up to this date (ISO 8601)'),
  format_mode: z
    .enum(['markdown', 'plaintext'])
    .optional()
    .describe('Response format (default: markdown)'),
});

const UploadAudioSchema = z.object({
  meeting_link: z.string().describe('Publicly accessible URL to an audio or video file'),
  title: z.string().describe('Title for the transcript'),
  custom_language: z.string().optional().describe('Language code for transcription (e.g. "en")'),
  client_reference_id: z.string().optional().describe('Optional reference ID for tracking'),
});

const GetTranscriptByIdSchema = z.object({
  id: z.string().describe('The transcript ID'),
});

const GetUserByIdSchema = z.object({
  userId: z.string().describe('The Fireflies user ID (uid)'),
});

const GetUserGroupsSchema = z.object({
  mine: z
    .boolean()
    .optional()
    .describe('If true, return only groups the authenticated user belongs to'),
});

const ExecuteGraphQLSchema = z.object({
  query: z.string().describe('A read-only GraphQL query string (must begin with "query")'),
  variables: z.record(z.any()).optional().describe('Optional variables for the GraphQL query'),
});

const FetchAiAppOutputsSchema = z.object({
  app_id: z.string().optional().describe('Filter outputs by AI App ID'),
  transcript_id: z.string().optional().describe('Filter outputs by transcript/meeting ID'),
});

const UpdateMeetingTitleSchema = z.object({
  id: z.string().describe('The transcript/meeting ID to update'),
  title: z.string().describe('The new title for the meeting'),
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'fireflies_get_user',
      description: 'Get the authenticated Fireflies user profile and account statistics.',
      inputSchema: zodToJsonSchema(GetUserSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_search_transcripts',
      description:
        'Search and list meeting transcripts with optional filters for date, keyword, organizer, or participants.',
      inputSchema: zodToJsonSchema(SearchTranscriptsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_transcript',
      description:
        'Get full details of a meeting transcript including transcript text, speakers, summary, and action items.',
      inputSchema: zodToJsonSchema(GetTranscriptSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_active_meetings',
      description: 'Get meetings currently in progress where Fireflies is active.',
      inputSchema: zodToJsonSchema(GetActiveMeetingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_ask_fred',
      description:
        'Ask Fred (Fireflies AI) a natural language question about one or all meetings. Returns an AI-generated answer with optional suggested follow-up queries.',
      inputSchema: zodToJsonSchema(AskFredSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'fireflies_upload_audio',
      description:
        'Submit a publicly accessible audio or video URL for transcription by Fireflies.',
      inputSchema: zodToJsonSchema(UploadAudioSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'fireflies_get_transcript_by_id',
      description:
        'Fetch complete details for a specific transcript by ID, including paid-plan fields such as video URL and full meeting attendee list. Requires a paid Fireflies plan.',
      inputSchema: zodToJsonSchema(GetTranscriptByIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_user_by_id',
      description:
        'Fetch profile details for a specific Fireflies team member by their user ID (uid).',
      inputSchema: zodToJsonSchema(GetUserByIdSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_user_groups',
      description:
        'Fetch all user groups within the team, including group members. Optionally filter to only groups the authenticated user belongs to.',
      inputSchema: zodToJsonSchema(GetUserGroupsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_execute_graphql',
      description:
        'Execute a raw read-only Fireflies GraphQL query and return the full response (data + errors). Use as a fallback when higher-level tools fail or to access fields not covered by other tools.',
      inputSchema: zodToJsonSchema(ExecuteGraphQLSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'fireflies_fetch_ai_app_outputs',
      description:
        'Fetch AI App outputs for specific apps or transcripts. Returns AI-generated results produced by Fireflies AI Apps for meetings.',
      inputSchema: zodToJsonSchema(FetchAiAppOutputsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_update_meeting_title',
      description:
        'Update the title of a meeting transcript. Requires admin privileges; the meeting owner must be in your team.',
      inputSchema: zodToJsonSchema(UpdateMeetingTitleSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>
) {
  try {
    switch (name) {
      case 'fireflies_get_user': {
        const query = `
          query {
            user {
              uid
              name
              email
              num_transcripts
              recent_transcript
              minutes_logged
              integrations {
                calendar
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query);
        const u = data.user;

        return {
          content: [
            {
              type: 'text',
              text: [
                `Name: ${u.name}`,
                `Email: ${u.email}`,
                `User ID: ${u.uid}`,
                `Transcripts: ${u.num_transcripts ?? 'N/A'}`,
                `Minutes logged: ${u.minutes_logged ?? 'N/A'}`,
                `Recent transcript: ${u.recent_transcript ?? 'N/A'}`,
                `Calendar integration: ${u.integrations?.calendar ?? 'None'}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'fireflies_search_transcripts': {
        const { limit, fromDate, toDate, keyword, mine, organizers, participants } =
          SearchTranscriptsSchema.parse(args);

        const params: Record<string, any> = {};
        if (limit !== undefined) params.limit = limit;
        if (fromDate !== undefined) params.fromDate = fromDate;
        if (toDate !== undefined) params.toDate = toDate;
        if (keyword !== undefined) params.keyword = keyword;
        if (mine !== undefined) params.mine = mine;
        if (organizers !== undefined) params.organizers = organizers;
        if (participants !== undefined) params.participants = participants;

        const query = `
          query SearchTranscripts(
            $limit: Int
            $fromDate: DateTime
            $toDate: DateTime
            $keyword: String
            $mine: Boolean
            $organizers: [String]
            $participants: [String]
          ) {
            transcripts(
              limit: $limit
              fromDate: $fromDate
              toDate: $toDate
              keyword: $keyword
              mine: $mine
              organizers: $organizers
              participants: $participants
            ) {
              id
              title
              date_uploaded
              duration
              participants {
                displayName
                email
              }
              summary {
                action_items
                overview
                keywords
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, params);
        const transcripts = data.transcripts || [];

        if (transcripts.length === 0) {
          return { content: [{ type: 'text', text: 'No transcripts found.' }] };
        }

        const list = transcripts
          .map((t: any) => {
            const parts = [
              `ID: ${t.id}`,
              `Title: ${t.title}`,
              `Date: ${t.date_uploaded}`,
              `Duration: ${t.duration ? `${Math.round(t.duration / 60)} min` : 'N/A'}`,
              `Participants: ${t.participants?.map((p: any) => p.displayName || p.email).join(', ') || 'N/A'}`,
            ];
            if (t.summary?.overview) parts.push(`Overview: ${t.summary.overview}`);
            if (t.summary?.action_items) parts.push(`Action items: ${t.summary.action_items}`);
            return parts.join('\n');
          })
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${transcripts.length} transcript(s):\n\n${list}` },
          ],
        };
      }

      case 'fireflies_get_transcript': {
        const { id } = GetTranscriptSchema.parse(args);

        const query = `
          query GetTranscript($id: String!) {
            transcript(id: $id) {
              id
              title
              date_uploaded
              duration
              organizer_email
              participants {
                displayName
                email
              }
              sentences {
                speaker_name
                raw_words
                start_time
                end_time
              }
              summary {
                action_items
                overview
                keywords
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, { id });
        const t = data.transcript;

        if (!t) {
          return { content: [{ type: 'text', text: `Transcript ${id} not found.` }] };
        }

        const participants =
          t.participants?.map((p: any) => p.displayName || p.email).join(', ') || 'N/A';
        const transcriptText =
          t.sentences
            ?.map((s: any) => `[${formatTime(s.start_time)}] ${s.speaker_name}: ${s.raw_words}`)
            .join('\n') || 'No transcript text available.';

        const parts = [
          `ID: ${t.id}`,
          `Title: ${t.title}`,
          `Date: ${t.date_uploaded}`,
          `Duration: ${t.duration ? `${Math.round(t.duration / 60)} min` : 'N/A'}`,
          `Organizer: ${t.organizer_email || 'N/A'}`,
          `Participants: ${participants}`,
        ];

        if (t.summary?.overview) parts.push(`\nOverview:\n${t.summary.overview}`);
        if (t.summary?.action_items) parts.push(`\nAction items:\n${t.summary.action_items}`);
        if (t.summary?.keywords) parts.push(`\nKeywords: ${t.summary.keywords}`);
        parts.push(`\nTranscript:\n${transcriptText}`);

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'fireflies_get_active_meetings': {
        const { states } = GetActiveMeetingsSchema.parse(args);

        const query = `
          query GetActiveMeetings($states: [String]) {
            live_meetings(states: $states) {
              id
              state
              organizer
              meeting_link
              started_at
              participants {
                displayName
                email
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, states ? { states } : {});
        const meetings = data.live_meetings || [];

        if (meetings.length === 0) {
          return { content: [{ type: 'text', text: 'No active meetings found.' }] };
        }

        const list = meetings
          .map((m: any) => {
            const participants =
              m.participants?.map((p: any) => p.displayName || p.email).join(', ') || 'N/A';
            return [
              `ID: ${m.id}`,
              `State: ${m.state}`,
              `Organizer: ${m.organizer || 'N/A'}`,
              `Meeting link: ${m.meeting_link || 'N/A'}`,
              `Started at: ${m.started_at || 'N/A'}`,
              `Participants: ${participants}`,
            ].join('\n');
          })
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${meetings.length} active meeting(s):\n\n${list}` },
          ],
        };
      }

      case 'fireflies_ask_fred': {
        const {
          query: userQuery,
          transcript_id,
          fromDate,
          toDate,
          format_mode,
        } = AskFredSchema.parse(args);

        const filters: Record<string, any> = {};
        if (fromDate) filters.fromDate = fromDate;
        if (toDate) filters.toDate = toDate;

        const mutation = `
          mutation AskFred(
            $query: String!
            $transcript_id: String
            $filters: AskFredFilters
            $format_mode: String
          ) {
            createAskFredThread(
              query: $query
              transcript_id: $transcript_id
              filters: $filters
              format_mode: $format_mode
            ) {
              thread_id
              message_id
              answer
              suggested_queries
            }
          }
        `;

        const variables: Record<string, any> = { query: userQuery };
        if (transcript_id) variables.transcript_id = transcript_id;
        if (Object.keys(filters).length > 0) variables.filters = filters;
        if (format_mode) variables.format_mode = format_mode;

        const data = await callFirefliesAPI(config, mutation, variables);
        const result = data.createAskFredThread;

        const parts = [`Answer:\n${result.answer}`];
        if (result.suggested_queries?.length) {
          parts.push(
            `\nSuggested follow-up questions:\n${result.suggested_queries.map((q: string) => `- ${q}`).join('\n')}`
          );
        }

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'fireflies_upload_audio': {
        const { meeting_link, title, custom_language, client_reference_id } =
          UploadAudioSchema.parse(args);

        const input: Record<string, any> = { meeting_link, title };
        if (custom_language) input.custom_language = custom_language;
        if (client_reference_id) input.client_reference_id = client_reference_id;

        const mutation = `
          mutation UploadAudio($input: UploadAudioInput!) {
            uploadAudio(input: $input) {
              success
              title
              message
            }
          }
        `;

        const data = await callFirefliesAPI(config, mutation, { input });
        const result = data.uploadAudio;

        return {
          content: [
            {
              type: 'text',
              text: result.success
                ? `Audio submitted for transcription.\nTitle: ${result.title}\n${result.message || ''}`
                : `Upload failed: ${result.message || 'Unknown error'}`,
            },
          ],
        };
      }

      case 'fireflies_get_transcript_by_id': {
        const { id } = GetTranscriptByIdSchema.parse(args);

        const query = `
          query GetTranscriptById($id: String!) {
            transcript(id: $id) {
              id
              title
              date_uploaded
              duration
              organizer_email
              video_url
              participants {
                displayName
                email
              }
              meeting_attendees {
                displayName
                email
                phoneNumber
                name
                location
              }
              sentences {
                speaker_name
                raw_words
                start_time
                end_time
              }
              summary {
                action_items
                overview
                keywords
                shorthand_bullet
                bullet_gist
                gist
                short_summary
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, { id });
        const t = data.transcript;

        if (!t) {
          return { content: [{ type: 'text', text: `Transcript ${id} not found.` }] };
        }

        const participants =
          t.participants?.map((p: any) => p.displayName || p.email).join(', ') || 'N/A';
        const attendees =
          t.meeting_attendees?.map((a: any) => a.displayName || a.name || a.email).join(', ') ||
          'N/A';
        const transcriptText =
          t.sentences
            ?.map((s: any) => `[${formatTime(s.start_time)}] ${s.speaker_name}: ${s.raw_words}`)
            .join('\n') || 'No transcript text available.';

        const parts = [
          `ID: ${t.id}`,
          `Title: ${t.title}`,
          `Date: ${t.date_uploaded}`,
          `Duration: ${t.duration ? `${Math.round(t.duration / 60)} min` : 'N/A'}`,
          `Organizer: ${t.organizer_email || 'N/A'}`,
          `Video URL: ${t.video_url || 'N/A'}`,
          `Participants: ${participants}`,
          `Meeting attendees: ${attendees}`,
        ];

        if (t.summary?.gist) parts.push(`\nGist: ${t.summary.gist}`);
        if (t.summary?.overview) parts.push(`\nOverview:\n${t.summary.overview}`);
        if (t.summary?.short_summary) parts.push(`\nShort summary:\n${t.summary.short_summary}`);
        if (t.summary?.action_items) parts.push(`\nAction items:\n${t.summary.action_items}`);
        if (t.summary?.keywords) parts.push(`\nKeywords: ${t.summary.keywords}`);
        if (t.summary?.bullet_gist) parts.push(`\nKey points:\n${t.summary.bullet_gist}`);
        parts.push(`\nTranscript:\n${transcriptText}`);

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      case 'fireflies_get_user_by_id': {
        const { userId } = GetUserByIdSchema.parse(args);

        const query = `
          query GetUserById($userId: String!) {
            user(id: $userId) {
              uid
              name
              email
              num_transcripts
              recent_transcript
              minutes_logged
              integrations {
                calendar
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, { userId });
        const u = data.user;

        if (!u) {
          return { content: [{ type: 'text', text: `User ${userId} not found.` }] };
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `Name: ${u.name}`,
                `Email: ${u.email}`,
                `User ID: ${u.uid}`,
                `Transcripts: ${u.num_transcripts ?? 'N/A'}`,
                `Minutes logged: ${u.minutes_logged ?? 'N/A'}`,
                `Recent transcript: ${u.recent_transcript ?? 'N/A'}`,
                `Calendar integration: ${u.integrations?.calendar ?? 'None'}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'fireflies_get_user_groups': {
        const { mine } = GetUserGroupsSchema.parse(args);

        const query = `
          query GetUserGroups($mine: Boolean) {
            userGroups(mine: $mine) {
              id
              name
              members {
                uid
                name
                email
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, mine !== undefined ? { mine } : {});
        const groups = data.userGroups || [];

        if (groups.length === 0) {
          return { content: [{ type: 'text', text: 'No user groups found.' }] };
        }

        const list = groups
          .map((g: any) => {
            const members =
              g.members?.map((m: any) => `${m.name || m.uid} <${m.email}>`).join(', ') ||
              'No members';
            return `Group: ${g.name} (ID: ${g.id})\nMembers: ${members}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${groups.length} group(s):\n\n${list}` }],
        };
      }

      case 'fireflies_execute_graphql': {
        const { query, variables } = ExecuteGraphQLSchema.parse(args);

        const trimmed = query.trim().toLowerCase();
        if (!trimmed.startsWith('query') && !trimmed.startsWith('{')) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: Only read-only queries are allowed. The query must start with "query" or "{".',
              },
            ],
          };
        }

        const data = await callFirefliesAPI(config, query, variables);

        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      }

      case 'fireflies_fetch_ai_app_outputs': {
        const { app_id, transcript_id } = FetchAiAppOutputsSchema.parse(args);

        const variables: Record<string, any> = {};
        if (app_id) variables.app_id = app_id;
        if (transcript_id) variables.transcript_id = transcript_id;

        const query = `
          query FetchAiAppOutputs($app_id: String, $transcript_id: String) {
            aiAppOutputs(app_id: $app_id, transcript_id: $transcript_id) {
              app_id
              transcript_id
              title
              outputs {
                prompt_title
                response
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, query, variables);
        const outputs = data.aiAppOutputs || [];

        if (outputs.length === 0) {
          return { content: [{ type: 'text', text: 'No AI App outputs found.' }] };
        }

        const list = outputs
          .map((o: any) => {
            const sections = [
              `App ID: ${o.app_id}`,
              `Transcript ID: ${o.transcript_id}`,
              `Title: ${o.title || 'N/A'}`,
            ];
            if (o.outputs?.length) {
              sections.push(
                '\nOutputs:\n' +
                  o.outputs
                    .map((item: any) => `  [${item.prompt_title}]\n  ${item.response}`)
                    .join('\n\n')
              );
            }
            return sections.join('\n');
          })
          .join('\n\n---\n\n');

        return {
          content: [{ type: 'text', text: `Found ${outputs.length} AI App output(s):\n\n${list}` }],
        };
      }

      case 'fireflies_update_meeting_title': {
        const { id, title } = UpdateMeetingTitleSchema.parse(args);

        const mutation = `
          mutation UpdateMeetingTitle($id: String!, $title: String!) {
            updateMeeting(input: { id: $id, title: $title }) {
              id
              title
            }
          }
        `;

        const data = await callFirefliesAPI(config, mutation, { id, title });
        const meeting = data.updateMeeting;

        return {
          content: [
            {
              type: 'text',
              text: `Meeting updated.\nID: ${meeting.id}\nNew title: ${meeting.title}`,
            },
          ],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const errorMessage =
      error.response?.data?.errors?.[0]?.message || error.response?.data?.message || error.message;
    return { content: [{ type: 'text', text: `Error: ${errorMessage}` }] };
  }
}

function formatTime(seconds: number): string {
  if (!seconds && seconds !== 0) return '?';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
