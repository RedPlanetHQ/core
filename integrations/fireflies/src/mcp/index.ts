/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { callFirefliesAPI } from '../utils';

// ─── Shared ──────────────────────────────────────────────────────────────────

const FormatSchema = z
  .enum(['json', 'text'])
  .optional()
  .describe('Response format: "json" or "text" (default: "text")');

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z
    .string()
    .describe(
      'Search query with optional mini grammar. Supported tokens: keyword:"term", scope:title|sentences|all, from:YYYY-MM-DD, to:YYYY-MM-DD, limit:N, skip:N, organizers:email1,email2, participants:email1,email2, mine:true|false. If no tokens are present, the full string is treated as a keyword search.'
    ),
  format: FormatSchema,
});

const GetTranscriptsSchema = z.object({
  keyword: z.string().optional().describe('Search term (max 255 chars)'),
  fromDate: z.string().optional().describe('Filter from date (YYYY-MM-DD)'),
  toDate: z.string().optional().describe('Filter to date (YYYY-MM-DD)'),
  limit: z.number().optional().describe('Max results (max 50, default 10)'),
  skip: z.number().optional().describe('Pagination offset'),
  organizers: z.array(z.string()).optional().describe('Filter by organizer emails'),
  participants: z.array(z.string()).optional().describe('Filter by participant emails'),
  mine: z.boolean().optional().describe("Return only the authenticated user's meetings"),
  format: FormatSchema,
});

const GetTranscriptSchema = z.object({
  transcriptId: z.string().describe('Meeting ID'),
});

const FetchSchema = z.object({
  id: z.string().describe('Meeting ID'),
});

const GetSummarySchema = z.object({
  transcriptId: z.string().describe('Meeting ID'),
});

const GetUserSchema = z.object({
  userId: z.string().optional().describe('User ID — omit to get the authenticated user'),
});

const GetUserGroupsSchema = z.object({
  mine: z
    .boolean()
    .optional()
    .describe('If true, return only groups the authenticated user belongs to'),
});

const GetUserContactsSchema = z.object({
  format: FormatSchema,
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

const FetchAiAppOutputsSchema = z.object({
  app_id: z.string().optional().describe('Filter outputs by AI App ID'),
  transcript_id: z.string().optional().describe('Filter outputs by transcript/meeting ID'),
});

const UpdateMeetingTitleSchema = z.object({
  id: z.string().describe('The transcript/meeting ID to update'),
  title: z.string().describe('The new title for the meeting'),
});

const ExecuteGraphQLSchema = z.object({
  query: z.string().describe('A read-only GraphQL query string (must begin with "query")'),
  variables: z.record(z.any()).optional().describe('Optional variables for the GraphQL query'),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export async function getTools() {
  return [
    // ── Official Fireflies MCP tools ──────────────────────────────────────────
    {
      name: 'fireflies_search',
      description:
        'Advanced search for meeting transcripts using mini grammar syntax. Supports keyword, scope, date range, participant filters, and pagination in a single query string.',
      inputSchema: zodToJsonSchema(SearchSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_transcripts',
      description:
        'Query multiple meetings with structured filters. Returns meeting metadata and summaries (excludes detailed transcript sentences).',
      inputSchema: zodToJsonSchema(GetTranscriptsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_transcript',
      description:
        'Fetch detailed transcript sentences with speaker attribution and timestamps for a single meeting. Does not include summary data — use fireflies_get_summary for that.',
      inputSchema: zodToJsonSchema(GetTranscriptSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_fetch',
      description:
        'Retrieve complete meeting data including transcript sentences, summary, action items, and all metadata in a single call.',
      inputSchema: zodToJsonSchema(FetchSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_summary',
      description:
        'Fetch meeting summary by ID — keywords, action items, overview, topics discussed, and outline. Excludes transcript sentences.',
      inputSchema: zodToJsonSchema(GetSummarySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_user',
      description:
        'Get user profile and account statistics. Returns the authenticated user when no userId is provided.',
      inputSchema: zodToJsonSchema(GetUserSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_usergroups',
      description:
        'Fetch user groups within the team, including group members. Optionally filter to only groups the authenticated user belongs to.',
      inputSchema: zodToJsonSchema(GetUserGroupsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'fireflies_get_user_contacts',
      description: 'Fetch contact list sorted by most recent meeting date.',
      inputSchema: zodToJsonSchema(GetUserContactsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    // ── Extra tools ───────────────────────────────────────────────────────────
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
    {
      name: 'fireflies_execute_graphql',
      description:
        'Execute a raw read-only Fireflies GraphQL query. Use as a fallback when higher-level tools fail or to access fields not covered by other tools.',
      inputSchema: zodToJsonSchema(ExecuteGraphQLSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!seconds && seconds !== 0) return '?';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderUser(u: any): string {
  return [
    `Name: ${u.name}`,
    `Email: ${u.email}`,
    `User ID: ${u.uid}`,
    `Transcripts: ${u.num_transcripts ?? 'N/A'}`,
    `Minutes logged: ${u.minutes_logged ?? 'N/A'}`,
    `Recent transcript: ${u.recent_transcript ?? 'N/A'}`,
    `Calendar integration: ${u.integrations?.calendar ?? 'None'}`,
  ].join('\n');
}

function renderTranscriptMeta(t: any): string {
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
}

/**
 * Parse mini grammar query string into transcripts query variables.
 * Supports: keyword:"term", scope:title|sentences|all, from:YYYY-MM-DD,
 * to:YYYY-MM-DD, limit:N, skip:N, organizers:e1,e2, participants:e1,e2, mine:true|false
 */
function parseSearchGrammar(query: string): Record<string, any> {
  const result: Record<string, any> = {};

  const extract = (pattern: RegExp): string | null => {
    const m = query.match(pattern);
    return m ? m[1] ?? m[2] ?? null : null;
  };

  const keyword = extract(/keyword:"([^"]+)"|keyword:(\S+)/);
  if (keyword) result.keyword = keyword;

  const from = extract(/from:(\S+)/);
  if (from) result.fromDate = from;

  const to = extract(/to:(\S+)/);
  if (to) result.toDate = to;

  const limit = extract(/limit:(\d+)/);
  if (limit) result.limit = parseInt(limit, 10);

  const skip = extract(/skip:(\d+)/);
  if (skip) result.skip = parseInt(skip, 10);

  const organizers = extract(/organizers:(\S+)/);
  if (organizers) result.organizers = organizers.split(',');

  const participants = extract(/participants:(\S+)/);
  if (participants) result.participants = participants.split(',');

  const mine = extract(/mine:(true|false)/);
  if (mine) result.mine = mine === 'true';

  // No tokens found — treat whole string as keyword
  if (Object.keys(result).length === 0 && query.trim()) {
    result.keyword = query.trim();
  }

  return result;
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>
) {
  try {
    switch (name) {
      // ── fireflies_search ───────────────────────────────────────────────────
      case 'fireflies_search': {
        const { query, format } = SearchSchema.parse(args);
        const parsed = parseSearchGrammar(query);

        const pageLimit = parsed.limit ?? 10;
        const pageSkip = parsed.skip ?? 0;

        const params: Record<string, any> = { limit: pageLimit, skip: pageSkip };
        if (parsed.keyword) params.keyword = parsed.keyword;
        if (parsed.fromDate) params.fromDate = parsed.fromDate;
        if (parsed.toDate) params.toDate = parsed.toDate;
        if (parsed.mine !== undefined) params.mine = parsed.mine;
        if (parsed.organizers) params.organizers = parsed.organizers;
        if (parsed.participants) params.participants = parsed.participants;

        const gql = `
          query SearchTranscripts(
            $limit: Int $skip: Int $keyword: String
            $fromDate: DateTime $toDate: DateTime
            $mine: Boolean $organizers: [String] $participants: [String]
          ) {
            transcripts(
              limit: $limit skip: $skip keyword: $keyword
              fromDate: $fromDate toDate: $toDate
              mine: $mine organizers: $organizers participants: $participants
            ) {
              id title date_uploaded duration
              participants { displayName email }
              summary { action_items overview keywords }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, params);
        const transcripts = data.transcripts || [];

        if (transcripts.length === 0) {
          return { content: [{ type: 'text', text: 'No transcripts found.' }] };
        }

        if (format === 'json') {
          return { content: [{ type: 'text', text: JSON.stringify(transcripts, null, 2) }] };
        }

        const hasMore = transcripts.length === pageLimit;
        const nextSkip = pageSkip + transcripts.length;
        const pagination = hasMore
          ? `\n\n📄 More results available. Use skip:${nextSkip} in your query.`
          : '';

        return {
          content: [
            {
              type: 'text',
              text:
                `Found ${transcripts.length} transcript(s):\n\n` +
                transcripts.map(renderTranscriptMeta).join('\n\n') +
                pagination,
            },
          ],
        };
      }

      // ── fireflies_get_transcripts ──────────────────────────────────────────
      case 'fireflies_get_transcripts': {
        const { keyword, fromDate, toDate, limit, skip, organizers, participants, mine, format } =
          GetTranscriptsSchema.parse(args);

        const pageLimit = limit ?? 10;
        const pageSkip = skip ?? 0;

        const params: Record<string, any> = { limit: pageLimit, skip: pageSkip };
        if (keyword) params.keyword = keyword;
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
        if (mine !== undefined) params.mine = mine;
        if (organizers) params.organizers = organizers;
        if (participants) params.participants = participants;

        const gql = `
          query GetTranscripts(
            $limit: Int $skip: Int $keyword: String
            $fromDate: DateTime $toDate: DateTime
            $mine: Boolean $organizers: [String] $participants: [String]
          ) {
            transcripts(
              limit: $limit skip: $skip keyword: $keyword
              fromDate: $fromDate toDate: $toDate
              mine: $mine organizers: $organizers participants: $participants
            ) {
              id title date_uploaded duration
              participants { displayName email }
              summary { action_items overview keywords }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, params);
        const transcripts = data.transcripts || [];

        if (transcripts.length === 0) {
          return { content: [{ type: 'text', text: 'No transcripts found.' }] };
        }

        if (format === 'json') {
          return { content: [{ type: 'text', text: JSON.stringify(transcripts, null, 2) }] };
        }

        const hasMore = transcripts.length === pageLimit;
        const nextSkip = pageSkip + transcripts.length;
        const pagination = hasMore
          ? `\n\n📄 More results available. Use skip: ${nextSkip} to fetch the next page.`
          : '';

        return {
          content: [
            {
              type: 'text',
              text:
                `Found ${transcripts.length} transcript(s) (skip: ${pageSkip}, limit: ${pageLimit}):\n\n` +
                transcripts.map(renderTranscriptMeta).join('\n\n') +
                pagination,
            },
          ],
        };
      }

      // ── fireflies_get_transcript ───────────────────────────────────────────
      case 'fireflies_get_transcript': {
        const { transcriptId } = GetTranscriptSchema.parse(args);

        const gql = `
          query GetTranscript($id: String!) {
            transcript(id: $id) {
              id title date_uploaded duration organizer_email
              participants { displayName email }
              sentences { speaker_name raw_words start_time end_time }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, { id: transcriptId });
        const t = data.transcript;

        if (!t) {
          return { content: [{ type: 'text', text: `Transcript ${transcriptId} not found.` }] };
        }

        const participants =
          t.participants?.map((p: any) => p.displayName || p.email).join(', ') || 'N/A';
        const transcriptText =
          t.sentences
            ?.map((s: any) => `[${formatTime(s.start_time)}] ${s.speaker_name}: ${s.raw_words}`)
            .join('\n') || 'No transcript text available.';

        return {
          content: [
            {
              type: 'text',
              text: [
                `ID: ${t.id}`,
                `Title: ${t.title}`,
                `Date: ${t.date_uploaded}`,
                `Duration: ${t.duration ? `${Math.round(t.duration / 60)} min` : 'N/A'}`,
                `Organizer: ${t.organizer_email || 'N/A'}`,
                `Participants: ${participants}`,
                `\nTranscript:\n${transcriptText}`,
              ].join('\n'),
            },
          ],
        };
      }

      // ── fireflies_fetch ────────────────────────────────────────────────────
      case 'fireflies_fetch': {
        const { id } = FetchSchema.parse(args);

        const gql = `
          query FetchMeeting($id: String!) {
            transcript(id: $id) {
              id title date_uploaded duration organizer_email video_url
              participants { displayName email }
              meeting_attendees { displayName email phoneNumber name location }
              sentences { speaker_name raw_words start_time end_time }
              summary {
                action_items overview keywords
                gist short_summary bullet_gist shorthand_bullet
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, { id });
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

      // ── fireflies_get_summary ──────────────────────────────────────────────
      case 'fireflies_get_summary': {
        const { transcriptId } = GetSummarySchema.parse(args);

        const gql = `
          query GetSummary($id: String!) {
            transcript(id: $id) {
              id title date_uploaded
              summary {
                action_items overview keywords
                gist short_summary bullet_gist shorthand_bullet
              }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, { id: transcriptId });
        const t = data.transcript;

        if (!t) {
          return { content: [{ type: 'text', text: `Transcript ${transcriptId} not found.` }] };
        }

        const s = t.summary;
        if (!s) {
          return {
            content: [{ type: 'text', text: `No summary available for transcript ${transcriptId}.` }],
          };
        }

        const parts = [`ID: ${t.id}`, `Title: ${t.title}`, `Date: ${t.date_uploaded}`];
        if (s.gist) parts.push(`\nGist: ${s.gist}`);
        if (s.overview) parts.push(`\nOverview:\n${s.overview}`);
        if (s.short_summary) parts.push(`\nShort summary:\n${s.short_summary}`);
        if (s.action_items) parts.push(`\nAction items:\n${s.action_items}`);
        if (s.keywords) parts.push(`\nKeywords: ${s.keywords}`);
        if (s.bullet_gist) parts.push(`\nKey points:\n${s.bullet_gist}`);
        if (s.shorthand_bullet) parts.push(`\nBullet notes:\n${s.shorthand_bullet}`);

        return { content: [{ type: 'text', text: parts.join('\n') }] };
      }

      // ── fireflies_get_user ─────────────────────────────────────────────────
      case 'fireflies_get_user': {
        const { userId } = GetUserSchema.parse(args);

        const gql = userId
          ? `
            query GetUserById($userId: String!) {
              user(id: $userId) {
                uid name email num_transcripts recent_transcript minutes_logged
                integrations { calendar }
              }
            }
          `
          : `
            query {
              user {
                uid name email num_transcripts recent_transcript minutes_logged
                integrations { calendar }
              }
            }
          `;

        const data = await callFirefliesAPI(config, gql, userId ? { userId } : undefined);
        const u = data.user;

        if (!u) {
          return {
            content: [{ type: 'text', text: userId ? `User ${userId} not found.` : 'User not found.' }],
          };
        }

        return { content: [{ type: 'text', text: renderUser(u) }] };
      }

      // ── fireflies_get_usergroups ───────────────────────────────────────────
      case 'fireflies_get_usergroups': {
        const { mine } = GetUserGroupsSchema.parse(args);

        const gql = `
          query GetUserGroups($mine: Boolean) {
            userGroups(mine: $mine) {
              id name
              members { uid name email }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, mine !== undefined ? { mine } : {});
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

      // ── fireflies_get_user_contacts ────────────────────────────────────────
      case 'fireflies_get_user_contacts': {
        const { format } = GetUserContactsSchema.parse(args);

        const gql = `
          query {
            contacts {
              email
              name
              profilePic
              lastMeetingDate
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql);
        const contacts = data.contacts || [];

        if (contacts.length === 0) {
          return { content: [{ type: 'text', text: 'No contacts found.' }] };
        }

        if (format === 'json') {
          return { content: [{ type: 'text', text: JSON.stringify(contacts, null, 2) }] };
        }

        const list = contacts
          .map(
            (c: any) =>
              `${c.name || '(no name)'} <${c.email}>${c.lastMeetingDate ? ` — last met: ${c.lastMeetingDate}` : ''}`
          )
          .join('\n');

        return {
          content: [{ type: 'text', text: `Found ${contacts.length} contact(s):\n\n${list}` }],
        };
      }

      // ── fireflies_get_active_meetings ──────────────────────────────────────
      case 'fireflies_get_active_meetings': {
        const { states } = GetActiveMeetingsSchema.parse(args);

        const gql = `
          query GetActiveMeetings($states: [String]) {
            live_meetings(states: $states) {
              id state organizer meeting_link started_at
              participants { displayName email }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, states ? { states } : {});
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

      // ── fireflies_ask_fred ─────────────────────────────────────────────────
      case 'fireflies_ask_fred': {
        const { query: userQuery, transcript_id, fromDate, toDate, format_mode } =
          AskFredSchema.parse(args);

        const filters: Record<string, any> = {};
        if (fromDate) filters.fromDate = fromDate;
        if (toDate) filters.toDate = toDate;

        const mutation = `
          mutation AskFred(
            $query: String! $transcript_id: String
            $filters: AskFredFilters $format_mode: String
          ) {
            createAskFredThread(
              query: $query transcript_id: $transcript_id
              filters: $filters format_mode: $format_mode
            ) {
              thread_id message_id answer suggested_queries
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

      // ── fireflies_upload_audio ─────────────────────────────────────────────
      case 'fireflies_upload_audio': {
        const { meeting_link, title, custom_language, client_reference_id } =
          UploadAudioSchema.parse(args);

        const input: Record<string, any> = { meeting_link, title };
        if (custom_language) input.custom_language = custom_language;
        if (client_reference_id) input.client_reference_id = client_reference_id;

        const mutation = `
          mutation UploadAudio($input: UploadAudioInput!) {
            uploadAudio(input: $input) { success title message }
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

      // ── fireflies_fetch_ai_app_outputs ─────────────────────────────────────
      case 'fireflies_fetch_ai_app_outputs': {
        const { app_id, transcript_id } = FetchAiAppOutputsSchema.parse(args);

        const variables: Record<string, any> = {};
        if (app_id) variables.app_id = app_id;
        if (transcript_id) variables.transcript_id = transcript_id;

        const gql = `
          query FetchAiAppOutputs($app_id: String, $transcript_id: String) {
            aiAppOutputs(app_id: $app_id, transcript_id: $transcript_id) {
              app_id transcript_id title
              outputs { prompt_title response }
            }
          }
        `;

        const data = await callFirefliesAPI(config, gql, variables);
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
          content: [
            { type: 'text', text: `Found ${outputs.length} AI App output(s):\n\n${list}` },
          ],
        };
      }

      // ── fireflies_update_meeting_title ─────────────────────────────────────
      case 'fireflies_update_meeting_title': {
        const { id, title } = UpdateMeetingTitleSchema.parse(args);

        const mutation = `
          mutation UpdateMeetingTitle($id: String!, $title: String!) {
            updateMeeting(input: { id: $id, title: $title }) { id title }
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

      // ── fireflies_execute_graphql ──────────────────────────────────────────
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
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
