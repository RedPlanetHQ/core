import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getSentryClient, SentryConfig } from '../utils';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ListIssuesSchema = z.object({
  project: z.string().optional().describe('Filter issues by project slug'),
  query: z.string().optional().describe('Sentry search query (e.g. "is:unresolved level:error")'),
  limit: z.number().optional().default(25).describe('Maximum number of issues to return (default: 25)'),
  sort: z
    .enum(['date', 'new', 'priority', 'freq', 'user'])
    .optional()
    .default('date')
    .describe('Sort order for issues'),
});

const GetIssueSchema = z.object({
  issue_id: z.string().describe('Sentry issue ID'),
});

const UpdateIssueSchema = z.object({
  issue_id: z.string().describe('Sentry issue ID to update'),
  status: z
    .enum(['resolved', 'resolvedInNextRelease', 'unresolved', 'ignored'])
    .optional()
    .describe('New status for the issue'),
  assignedTo: z.string().optional().describe('Username or team to assign the issue to'),
});

const ListEventsSchema = z.object({
  issue_id: z.string().describe('Sentry issue ID to list events for'),
  limit: z.number().optional().default(25).describe('Maximum number of events to return'),
  full: z.boolean().optional().default(false).describe('Include full event details'),
});

const ListProjectsSchema = z.object({
  limit: z.number().optional().default(25).describe('Maximum number of projects to return'),
});

const GetProjectSchema = z.object({
  project_slug: z.string().describe('Project slug'),
});

const ListReleasesSchema = z.object({
  project: z.string().optional().describe('Filter releases by project slug'),
  query: z.string().optional().describe('Search query for releases'),
  limit: z.number().optional().default(25).describe('Maximum number of releases to return'),
});

const GetReleaseSchema = z.object({
  version: z.string().describe('Release version identifier'),
});

const ListTeamsSchema = z.object({
  limit: z.number().optional().default(25).describe('Maximum number of teams to return'),
});

const GetOrganizationSchema = z.object({});

const ListMembersSchema = z.object({
  limit: z.number().optional().default(25).describe('Maximum number of members to return'),
});

// Pre-convert schemas to avoid deep TS instantiation
const listIssuesSchemaJson = zodToJsonSchema(ListIssuesSchema) as Record<string, unknown>;
const getIssueSchemaJson = zodToJsonSchema(GetIssueSchema) as Record<string, unknown>;
const updateIssueSchemaJson = zodToJsonSchema(UpdateIssueSchema) as Record<string, unknown>;
const listEventsSchemaJson = zodToJsonSchema(ListEventsSchema) as Record<string, unknown>;
const listProjectsSchemaJson = zodToJsonSchema(ListProjectsSchema) as Record<string, unknown>;
const getProjectSchemaJson = zodToJsonSchema(GetProjectSchema) as Record<string, unknown>;
const listReleasesSchemaJson = zodToJsonSchema(ListReleasesSchema) as Record<string, unknown>;
const getReleaseSchemaJson = zodToJsonSchema(GetReleaseSchema) as Record<string, unknown>;
const listTeamsSchemaJson = zodToJsonSchema(ListTeamsSchema) as Record<string, unknown>;
const getOrganizationSchemaJson = zodToJsonSchema(GetOrganizationSchema) as Record<string, unknown>;
const listMembersSchemaJson = zodToJsonSchema(ListMembersSchema) as Record<string, unknown>;

// ─── Tool list ────────────────────────────────────────────────────────────────

export function getTools() {
  return [
    {
      name: 'sentry_list_issues',
      description:
        'List Sentry issues for the organization. Filter by project, status, level, or custom search query.',
      inputSchema: listIssuesSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_get_issue',
      description: 'Get details of a specific Sentry issue by its ID, including stack traces and metadata.',
      inputSchema: getIssueSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_update_issue',
      description: 'Update a Sentry issue — resolve it, ignore it, or reassign it to a team member.',
      inputSchema: updateIssueSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'sentry_list_events',
      description: 'List individual error events for a Sentry issue.',
      inputSchema: listEventsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_list_projects',
      description: 'List all projects in the Sentry organization.',
      inputSchema: listProjectsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_get_project',
      description: 'Get details of a specific Sentry project by its slug.',
      inputSchema: getProjectSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_list_releases',
      description: 'List releases in the Sentry organization, optionally filtered by project.',
      inputSchema: listReleasesSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_get_release',
      description: 'Get details of a specific release by version identifier.',
      inputSchema: getReleaseSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_list_teams',
      description: 'List all teams in the Sentry organization.',
      inputSchema: listTeamsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_get_organization',
      description: 'Get details about the connected Sentry organization.',
      inputSchema: getOrganizationSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'sentry_list_members',
      description: 'List members of the Sentry organization.',
      inputSchema: listMembersSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool runner ─────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  config: SentryConfig
): Promise<unknown> {
  const client = getSentryClient(config.auth_token, config.host);
  const orgSlug = config.organization_slug;

  const ok = (data: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });

  const err = (msg: string) => ({
    content: [{ type: 'text', text: `Error: ${msg}` }],
    isError: true,
  });

  try {
    switch (name) {
      case 'sentry_list_issues': {
        const { project, query, limit, sort } = ListIssuesSchema.parse(args);
        const params: Record<string, unknown> = { limit, sort };
        if (project) params.project = project;
        if (query) params.query = query;

        const response = await client.get(`/api/0/organizations/${orgSlug}/issues/`, { params });
        return ok(response.data);
      }

      case 'sentry_get_issue': {
        const { issue_id } = GetIssueSchema.parse(args);
        const response = await client.get(`/api/0/issues/${issue_id}/`);
        return ok(response.data);
      }

      case 'sentry_update_issue': {
        const { issue_id, status, assignedTo } = UpdateIssueSchema.parse(args);
        const body: Record<string, unknown> = {};
        if (status !== undefined) body.status = status;
        if (assignedTo !== undefined) body.assignedTo = assignedTo;

        const response = await client.put(`/api/0/issues/${issue_id}/`, body);
        return ok(response.data);
      }

      case 'sentry_list_events': {
        const { issue_id, limit, full } = ListEventsSchema.parse(args);
        const response = await client.get(`/api/0/issues/${issue_id}/events/`, {
          params: { limit, full },
        });
        return ok(response.data);
      }

      case 'sentry_list_projects': {
        const { limit } = ListProjectsSchema.parse(args);
        const response = await client.get(`/api/0/organizations/${orgSlug}/projects/`, {
          params: { limit },
        });
        return ok(response.data);
      }

      case 'sentry_get_project': {
        const { project_slug } = GetProjectSchema.parse(args);
        const response = await client.get(`/api/0/projects/${orgSlug}/${project_slug}/`);
        return ok(response.data);
      }

      case 'sentry_list_releases': {
        const { project, query, limit } = ListReleasesSchema.parse(args);
        const params: Record<string, unknown> = { limit };
        if (project) params.project = project;
        if (query) params.query = query;

        const response = await client.get(`/api/0/organizations/${orgSlug}/releases/`, { params });
        return ok(response.data);
      }

      case 'sentry_get_release': {
        const { version } = GetReleaseSchema.parse(args);
        const response = await client.get(
          `/api/0/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`
        );
        return ok(response.data);
      }

      case 'sentry_list_teams': {
        const { limit } = ListTeamsSchema.parse(args);
        const response = await client.get(`/api/0/organizations/${orgSlug}/teams/`, {
          params: { limit },
        });
        return ok(response.data);
      }

      case 'sentry_get_organization': {
        const response = await client.get(`/api/0/organizations/${orgSlug}/`);
        return ok(response.data);
      }

      case 'sentry_list_members': {
        const { limit } = ListMembersSchema.parse(args);
        const response = await client.get(`/api/0/organizations/${orgSlug}/members/`, {
          params: { limit },
        });
        return ok(response.data);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const axiosErr = error as { response?: { data?: { detail?: string; message?: string } }; message?: string };
    const message =
      axiosErr.response?.data?.detail ||
      axiosErr.response?.data?.message ||
      axiosErr.message;
    return err(message ?? 'Unknown error');
  }
}
