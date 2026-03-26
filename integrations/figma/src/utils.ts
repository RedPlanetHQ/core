import axios, { AxiosInstance } from 'axios';

export const FIGMA_BASE_URL = 'https://api.figma.com';

/**
 * Creates an Axios instance pre-configured for the Figma REST API.
 */
export function createFigmaClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: FIGMA_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// ---------------------------------------------------------------------------
// Typed API wrapper stubs
// ---------------------------------------------------------------------------

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaFile {
  key: string;
  name: string;
  thumbnail_url: string;
  last_modified: string;
}

export interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  user: { handle: string; img_url: string };
}

export interface FigmaVersion {
  id: string;
  created_at: string;
  label: string;
  description: string;
  user: { handle: string };
}

export interface FigmaWebhook {
  id: string;
  team_id: string;
  event_type: string;
  client_id: string;
  endpoint: string;
  passcode: string;
  status: string;
}

/**
 * GET /v1/teams/:team_id/projects
 * Returns all projects for the given Figma team.
 */
export async function getTeamProjects(
  client: AxiosInstance,
  teamId: string,
): Promise<FigmaProject[]> {
  const response = await client.get(`/v1/teams/${teamId}/projects`);
  return response.data.projects as FigmaProject[];
}

/**
 * GET /v1/projects/:project_id/files
 * Returns all files inside a Figma project.
 */
export async function getProjectFiles(
  client: AxiosInstance,
  projectId: string,
): Promise<FigmaFile[]> {
  const response = await client.get(`/v1/projects/${projectId}/files`);
  return response.data.files as FigmaFile[];
}

/**
 * GET /v1/files/:file_key
 * Returns document metadata for a specific Figma file.
 */
export async function getFile(
  client: AxiosInstance,
  fileKey: string,
): Promise<Record<string, unknown>> {
  const response = await client.get(`/v1/files/${fileKey}`);
  return response.data as Record<string, unknown>;
}

/**
 * GET /v1/files/:file_key/comments
 * Returns all comments on a Figma file.
 */
export async function getFileComments(
  client: AxiosInstance,
  fileKey: string,
): Promise<FigmaComment[]> {
  const response = await client.get(`/v1/files/${fileKey}/comments`);
  return response.data.comments as FigmaComment[];
}

/**
 * GET /v1/files/:file_key/versions
 * Returns all version history entries for a Figma file.
 */
export async function getFileVersions(
  client: AxiosInstance,
  fileKey: string,
): Promise<FigmaVersion[]> {
  const response = await client.get(`/v1/files/${fileKey}/versions`);
  return response.data.versions as FigmaVersion[];
}

/**
 * POST /v2/webhooks
 * Registers a Figma webhook for the given team and event type.
 */
export async function createWebhook(
  client: AxiosInstance,
  params: {
    event_type: string;
    team_id: string;
    endpoint: string;
    passcode: string;
    description?: string;
  },
): Promise<FigmaWebhook> {
  // TODO: Implement full webhook handler to receive and process Figma events.
  const response = await client.post('/v2/webhooks', params);
  return response.data as FigmaWebhook;
}
