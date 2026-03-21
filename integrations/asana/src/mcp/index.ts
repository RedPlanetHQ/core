import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function createAsanaClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://app.asana.com/api/1.0',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// SCHEMAS
// ============================================================================

const ListWorkspacesSchema = z.object({
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
});

const ListProjectsSchema = z.object({
  workspace: z.string().describe('Workspace GID to list projects from'),
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
  archived: z.boolean().optional().describe('Filter by archived status'),
});

const ListTasksSchema = z.object({
  project: z.string().describe('Project GID to list tasks from'),
  limit: z.number().optional().default(50).describe('Number of results per page (max 100)'),
  offset: z.string().optional().describe('Pagination offset token from a previous response'),
  completed_since: z
    .string()
    .optional()
    .describe('ISO 8601 date-time; only return tasks completed after this time'),
});

const GetTaskSchema = z.object({
  task_gid: z.string().describe('Task GID'),
});

const CreateTaskSchema = z.object({
  name: z.string().describe('Task name'),
  workspace: z.string().describe('Workspace GID (required if no projects specified)'),
  projects: z.array(z.string()).optional().describe('Array of project GIDs to add the task to'),
  notes: z.string().optional().describe('Task description / notes (plain text)'),
  assignee: z.string().optional().describe('User GID or "me" to assign the task'),
  due_on: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  due_at: z.string().optional().describe('Due date-time in ISO 8601 format'),
  parent: z.string().optional().describe('Parent task GID (for subtasks)'),
});

const AddCommentSchema = z.object({
  task_gid: z.string().describe('Task GID to comment on'),
  text: z.string().describe('Comment text (plain text)'),
  is_pinned: z.boolean().optional().describe('Pin this comment to the task'),
});

// ============================================================================
// TOOL LIST
// ============================================================================

export async function getTools() {
  return [
    {
      name: 'asana_list_workspaces',
      description: 'List all Asana workspaces the authenticated user can access',
      inputSchema: zodToJsonSchema(ListWorkspacesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_list_projects',
      description: 'List projects within a workspace, with pagination',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_list_tasks',
      description: 'List tasks within a project, with pagination',
      inputSchema: zodToJsonSchema(ListTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_get_task',
      description: 'Get full details of a specific Asana task by GID',
      inputSchema: zodToJsonSchema(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'asana_create_task',
      description: 'Create a new task in Asana',
      inputSchema: zodToJsonSchema(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'asana_add_comment',
      description: 'Add a comment (story) to an Asana task',
      inputSchema: zodToJsonSchema(AddCommentSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: Record<string, any>,
) {
  const accessToken = config?.access_token ?? config?.mcp?.tokens?.access_token;

  if (!accessToken) {
    return { content: [{ type: 'text', text: 'Error: missing access_token in config' }] };
  }

  const client = createAsanaClient(accessToken);

  try {
    switch (name) {
      case 'asana_list_workspaces': {
        const { limit, offset } = ListWorkspacesSchema.parse(args);

        const params: Record<string, any> = { limit, opt_fields: 'gid,name,is_organization' };
        if (offset) params.offset = offset;

        const response = await client.get('/workspaces', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No workspaces found.' }] };
        }

        let text = `Found ${data.length} workspace(s):\n\n`;
        data.forEach((ws: any) => {
          text += `${ws.name}\n  GID: ${ws.gid}\n`;
          if (ws.is_organization) text += `  Type: Organization\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More workspaces available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_list_projects': {
        const { workspace, limit, offset, archived } = ListProjectsSchema.parse(args);

        const params: Record<string, any> = {
          workspace,
          limit,
          opt_fields: 'gid,name,archived,created_at,modified_at,owner.name,color',
        };
        if (offset) params.offset = offset;
        if (archived !== undefined) params.archived = archived;

        const response = await client.get('/projects', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No projects found.' }] };
        }

        let text = `Found ${data.length} project(s):\n\n`;
        data.forEach((proj: any) => {
          text += `${proj.name}\n  GID: ${proj.gid}\n`;
          if (proj.archived) text += `  [archived]\n`;
          if (proj.owner?.name) text += `  Owner: ${proj.owner.name}\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More projects available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_list_tasks': {
        const { project, limit, offset, completed_since } = ListTasksSchema.parse(args);

        const params: Record<string, any> = {
          project,
          limit,
          opt_fields:
            'gid,name,completed,due_on,due_at,assignee.name,created_at,modified_at,notes',
        };
        if (offset) params.offset = offset;
        if (completed_since) params.completed_since = completed_since;

        const response = await client.get('/tasks', { params });
        const { data, next_page } = response.data;

        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: 'No tasks found.' }] };
        }

        let text = `Found ${data.length} task(s):\n\n`;
        data.forEach((task: any) => {
          text += `${task.name}\n  GID: ${task.gid}\n`;
          text += `  Completed: ${task.completed ? 'Yes' : 'No'}\n`;
          if (task.assignee?.name) text += `  Assignee: ${task.assignee.name}\n`;
          if (task.due_on) text += `  Due: ${task.due_on}\n`;
          text += '\n';
        });

        if (next_page?.offset) {
          text += `More tasks available. Use offset: "${next_page.offset}"`;
        }

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_get_task': {
        const { task_gid } = GetTaskSchema.parse(args);

        const response = await client.get(`/tasks/${task_gid}`, {
          params: {
            opt_fields:
              'gid,name,notes,completed,due_on,due_at,assignee.name,assignee.email,projects.name,workspace.name,created_at,modified_at,parent.name,num_subtasks,tags.name,permalink_url',
          },
        });
        const task = response.data.data;

        let text = `${task.name}\n`;
        text += `GID: ${task.gid}\n`;
        text += `Completed: ${task.completed ? 'Yes' : 'No'}\n`;
        if (task.assignee) text += `Assignee: ${task.assignee.name} (${task.assignee.email})\n`;
        if (task.due_on) text += `Due: ${task.due_on}\n`;
        if (task.projects?.length) {
          text += `Projects: ${task.projects.map((p: any) => p.name).join(', ')}\n`;
        }
        if (task.workspace) text += `Workspace: ${task.workspace.name}\n`;
        if (task.parent) text += `Parent: ${task.parent.name}\n`;
        if (task.num_subtasks) text += `Subtasks: ${task.num_subtasks}\n`;
        if (task.notes) text += `\nNotes:\n${task.notes}\n`;
        if (task.permalink_url) text += `\nURL: ${task.permalink_url}\n`;

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_create_task': {
        const validated = CreateTaskSchema.parse(args);

        const body: Record<string, any> = {
          data: {
            name: validated.name,
            workspace: validated.workspace,
          },
        };

        if (validated.notes) body.data.notes = validated.notes;
        if (validated.assignee) body.data.assignee = validated.assignee;
        if (validated.due_on) body.data.due_on = validated.due_on;
        if (validated.due_at) body.data.due_at = validated.due_at;
        if (validated.projects?.length) body.data.projects = validated.projects;
        if (validated.parent) body.data.parent = validated.parent;

        const response = await client.post('/tasks', body);
        const task = response.data.data;

        let text = `Task created successfully.\n`;
        text += `Name: ${task.name}\n`;
        text += `GID: ${task.gid}\n`;
        if (task.permalink_url) text += `URL: ${task.permalink_url}\n`;

        return { content: [{ type: 'text', text }] };
      }

      case 'asana_add_comment': {
        const { task_gid, text: commentText, is_pinned } = AddCommentSchema.parse(args);

        const body: Record<string, any> = {
          data: {
            text: commentText,
          },
        };
        if (is_pinned !== undefined) body.data.is_pinned = is_pinned;

        const response = await client.post(`/tasks/${task_gid}/stories`, body);
        const story = response.data.data;

        return {
          content: [
            {
              type: 'text',
              text: `Comment added successfully.\nStory GID: ${story.gid}\nText: ${story.text}`,
            },
          ],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    const message =
      error.response?.data?.errors?.[0]?.message ?? error.response?.data?.message ?? error.message;
    return { content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}
