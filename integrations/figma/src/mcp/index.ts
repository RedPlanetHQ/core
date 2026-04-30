import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  createFigmaClient,
  getTeamProjects,
  getProjectFiles,
  getFile,
  getFileComments,
  getFileVersions,
  createWebhook,
} from '../utils';

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const GetTeamProjectsSchema = z.object({
  team_id: z.string().describe('Figma team ID'),
});

const GetProjectFilesSchema = z.object({
  project_id: z.string().describe('Figma project ID'),
});

const GetFileSchema = z.object({
  file_key: z.string().describe('Figma file key (from the file URL)'),
});

const GetFileCommentsSchema = z.object({
  file_key: z.string().describe('Figma file key'),
});

const GetFileVersionsSchema = z.object({
  file_key: z.string().describe('Figma file key'),
});

const CreateWebhookSchema = z.object({
  team_id: z.string().describe('Team ID to scope the webhook to'),
  event_type: z
    .enum([
      'FILE_UPDATE',
      'FILE_VERSION_UPDATE',
      'FILE_COMMENT',
      'FILE_DELETE',
      'LIBRARY_PUBLISH',
    ])
    .describe('Figma webhook event type'),
  endpoint: z.string().url().describe('HTTPS endpoint that will receive the webhook payload'),
  passcode: z.string().describe('Passcode included in each webhook request for verification'),
  description: z.string().optional().describe('Optional human-readable description'),
});

// ============================================================================
// TOOLS LIST
// ============================================================================

export function getTools() {
  return [
    {
      name: 'figma_get_team_projects',
      description: 'Lists all projects inside a Figma team',
      inputSchema: zodToJsonSchema(GetTeamProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'figma_get_project_files',
      description: 'Lists all files inside a Figma project',
      inputSchema: zodToJsonSchema(GetProjectFilesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'figma_get_file',
      description: 'Fetches the document metadata and node tree for a Figma file',
      inputSchema: zodToJsonSchema(GetFileSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'figma_get_file_comments',
      description: 'Returns all comments on a Figma file',
      inputSchema: zodToJsonSchema(GetFileCommentsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'figma_get_file_versions',
      description: 'Returns the version history of a Figma file',
      inputSchema: zodToJsonSchema(GetFileVersionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'figma_create_webhook',
      description: 'Registers a Figma webhook to receive real-time events for a team',
      inputSchema: zodToJsonSchema(CreateWebhookSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ============================================================================
// TOOL DISPATCHER
// ============================================================================

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  accessToken: string,
) {
  const client = createFigmaClient(accessToken);

  switch (name) {
    case 'figma_get_team_projects': {
      const { team_id } = GetTeamProjectsSchema.parse(args);
      return await getTeamProjects(client, team_id);
    }

    case 'figma_get_project_files': {
      const { project_id } = GetProjectFilesSchema.parse(args);
      return await getProjectFiles(client, project_id);
    }

    case 'figma_get_file': {
      const { file_key } = GetFileSchema.parse(args);
      return await getFile(client, file_key);
    }

    case 'figma_get_file_comments': {
      const { file_key } = GetFileCommentsSchema.parse(args);
      return await getFileComments(client, file_key);
    }

    case 'figma_get_file_versions': {
      const { file_key } = GetFileVersionsSchema.parse(args);
      return await getFileVersions(client, file_key);
    }

    case 'figma_create_webhook': {
      const params = CreateWebhookSchema.parse(args);
      // TODO: Store returned webhook ID in integration config for later cleanup.
      return await createWebhook(client, params);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
