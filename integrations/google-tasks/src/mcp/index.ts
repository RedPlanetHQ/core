import { google, tasks_v1 } from 'googleapis';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';

// OAuth2 configuration
let oauth2Client: OAuth2Client;
let tasks: tasks_v1.Tasks;

async function loadCredentials(
  client_id: string,
  client_secret: string,
  callback: string,
  config: Record<string, string>
) {
  try {
    oauth2Client = new OAuth2Client(client_id, client_secret, callback);

    const credentials = {
      refresh_token: config.refresh_token,
      expiry_date:
        typeof config.expires_at === 'string' ? parseInt(config.expires_at) : config.expires_at,
      expires_in: config.expires_in,
      expires_at: config.expires_at,
      access_token: config.access_token,
      token_type: config.token_type,
      id_token: config.id_token,
      scope: config.scope,
    };

    oauth2Client.setCredentials(credentials);
    oauth2Client.refreshAccessToken();
  } catch (error) {
    console.error('Error loading credentials:', error);
    process.exit(1);
  }
}

// Schema definitions for Google Tasks operations
const ListTaskListsSchema = z.object({
  maxResults: z
    .number()
    .optional()
    .describe('Maximum number of task lists to return (default: 100, max: 100)'),
  pageToken: z.string().optional().describe('Token specifying the result page to return'),
});

const GetTaskListSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
});

const CreateTaskListSchema = z.object({
  title: z.string().describe('Title of the task list'),
});

const UpdateTaskListSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  title: z.string().describe('New title for the task list'),
});

const DeleteTaskListSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
});

const ListTasksSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  maxResults: z
    .number()
    .optional()
    .describe('Maximum number of tasks to return (default: 100, max: 100)'),
  pageToken: z.string().optional().describe('Token specifying the result page to return'),
  showCompleted: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include completed tasks in the result'),
  showHidden: z.boolean().optional().default(false).describe('Include hidden tasks'),
  dueMin: z.string().optional().describe('Lower bound for due date (RFC 3339 timestamp)'),
  dueMax: z.string().optional().describe('Upper bound for due date (RFC 3339 timestamp)'),
  completedMin: z
    .string()
    .optional()
    .describe('Lower bound for completion date (RFC 3339 timestamp)'),
  completedMax: z
    .string()
    .optional()
    .describe('Upper bound for completion date (RFC 3339 timestamp)'),
  updatedMin: z.string().optional().describe('Lower bound for last modification time'),
});

const GetTaskSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  taskId: z.string().describe('Task identifier'),
});

const CreateTaskSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  title: z.string().describe('Title of the task'),
  notes: z.string().optional().describe('Notes describing the task'),
  due: z.string().optional().describe('Due date of the task (RFC 3339 timestamp)'),
  parent: z.string().optional().describe('Parent task identifier for subtasks'),
  previous: z.string().optional().describe('Previous sibling task identifier (for positioning)'),
});

const UpdateTaskSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  taskId: z.string().describe('Task identifier'),
  title: z.string().optional().describe('New title of the task'),
  notes: z.string().optional().describe('New notes for the task'),
  status: z.enum(['needsAction', 'completed']).optional().describe('Status of the task'),
  due: z.string().optional().describe('Due date of the task (RFC 3339 timestamp)'),
  completed: z.string().optional().describe('Completion date (RFC 3339 timestamp)'),
});

const DeleteTaskSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  taskId: z.string().describe('Task identifier'),
});

const MoveTaskSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
  taskId: z.string().describe('Task identifier'),
  parent: z.string().optional().describe('New parent task identifier'),
  previous: z.string().optional().describe('New previous sibling task identifier'),
});

const ClearCompletedTasksSchema = z.object({
  taskListId: z.string().describe('Task list identifier'),
});

/**
 * Get list of available tools without starting the MCP server
 */
export async function getTools() {
  const tools = [
    {
      name: 'list_task_lists',
      description: "Returns all the authenticated user's task lists",
      inputSchema: zodToJsonSchema(ListTaskListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_task_list',
      description: "Returns the authenticated user's specified task list",
      inputSchema: zodToJsonSchema(GetTaskListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_task_list',
      description: 'Creates a new task list',
      inputSchema: zodToJsonSchema(CreateTaskListSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'update_task_list',
      description: "Updates the authenticated user's specified task list",
      inputSchema: zodToJsonSchema(UpdateTaskListSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'delete_task_list',
      description: "Deletes the authenticated user's specified task list",
      inputSchema: zodToJsonSchema(DeleteTaskListSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'list_tasks',
      description: 'Returns all tasks in the specified task list',
      inputSchema: zodToJsonSchema(ListTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_task',
      description: 'Returns the specified task',
      inputSchema: zodToJsonSchema(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_task',
      description: 'Creates a new task on the specified task list',
      inputSchema: zodToJsonSchema(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'update_task',
      description: 'Updates the specified task',
      inputSchema: zodToJsonSchema(UpdateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'delete_task',
      description: 'Deletes the specified task from the task list',
      inputSchema: zodToJsonSchema(DeleteTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'move_task',
      description: 'Moves the specified task to another position in the task list',
      inputSchema: zodToJsonSchema(MoveTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'clear_completed_tasks',
      description: 'Clears all completed tasks from the specified task list',
      inputSchema: zodToJsonSchema(ClearCompletedTasksSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
  ];

  return tools;
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  await loadCredentials(client_id, client_secret, callback, credentials);

  // Initialize Google Tasks API
  tasks = google.tasks({ version: 'v1', auth: oauth2Client });

  try {
    switch (name) {
      case 'list_task_lists': {
        const validatedArgs = ListTaskListsSchema.parse(args);
        const response = await tasks.tasklists.list({
          maxResults: validatedArgs.maxResults,
          pageToken: validatedArgs.pageToken,
        });

        const taskLists = response.data.items || [];
        const formattedLists = taskLists
          .map(list => `ID: ${list.id}\nTitle: ${list.title}\nUpdated: ${list.updated}\n`)
          .join('\n');

        let resultText = `Found ${taskLists.length} task lists:\n\n${formattedLists}`;

        // Include pagination info if there are more results
        if (response.data.nextPageToken) {
          resultText += `\n\n📄 More results available. Use pageToken: ${response.data.nextPageToken}`;
        }

        return {
          content: [
            {
              type: 'text',
              text: resultText,
            },
          ],
        };
      }

      case 'get_task_list': {
        const validatedArgs = GetTaskListSchema.parse(args);
        const response = await tasks.tasklists.get({
          tasklist: validatedArgs.taskListId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task List Details:\nID: ${response.data.id}\nTitle: ${response.data.title}\nUpdated: ${response.data.updated}`,
            },
          ],
        };
      }

      case 'create_task_list': {
        const validatedArgs = CreateTaskListSchema.parse(args);
        const response = await tasks.tasklists.insert({
          requestBody: {
            title: validatedArgs.title,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task list created successfully:\nID: ${response.data.id}\nTitle: ${response.data.title}`,
            },
          ],
        };
      }

      case 'update_task_list': {
        const validatedArgs = UpdateTaskListSchema.parse(args);
        const response = await tasks.tasklists.update({
          tasklist: validatedArgs.taskListId,
          requestBody: {
            title: validatedArgs.title,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task list updated successfully:\nID: ${response.data.id}\nTitle: ${response.data.title}`,
            },
          ],
        };
      }

      case 'delete_task_list': {
        const validatedArgs = DeleteTaskListSchema.parse(args);
        await tasks.tasklists.delete({
          tasklist: validatedArgs.taskListId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task list ${validatedArgs.taskListId} deleted successfully`,
            },
          ],
        };
      }

      case 'list_tasks': {
        const validatedArgs = ListTasksSchema.parse(args);
        const response = await tasks.tasks.list({
          tasklist: validatedArgs.taskListId,
          maxResults: validatedArgs.maxResults,
          pageToken: validatedArgs.pageToken,
          showCompleted: validatedArgs.showCompleted,
          showHidden: validatedArgs.showHidden,
          dueMin: validatedArgs.dueMin,
          dueMax: validatedArgs.dueMax,
          completedMin: validatedArgs.completedMin,
          completedMax: validatedArgs.completedMax,
          updatedMin: validatedArgs.updatedMin,
        });

        const taskList = response.data.items || [];
        const formattedTasks = taskList
          .map(
            task =>
              `ID: ${task.id}\nTitle: ${task.title}\nStatus: ${task.status}\nDue: ${task.due || 'Not set'}\nNotes: ${task.notes || 'None'}\nUpdated: ${task.updated}\n`
          )
          .join('\n');

        let resultText = `Found ${taskList.length} tasks:\n\n${formattedTasks}`;

        // Include pagination info if there are more results
        if (response.data.nextPageToken) {
          resultText += `\n\n📄 More results available. Use pageToken: ${response.data.nextPageToken}`;
        }

        return {
          content: [
            {
              type: 'text',
              text: resultText,
            },
          ],
        };
      }

      case 'get_task': {
        const validatedArgs = GetTaskSchema.parse(args);
        const response = await tasks.tasks.get({
          tasklist: validatedArgs.taskListId,
          task: validatedArgs.taskId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task Details:\nID: ${response.data.id}\nTitle: ${response.data.title}\nStatus: ${response.data.status}\nDue: ${response.data.due || 'Not set'}\nNotes: ${response.data.notes || 'None'}\nUpdated: ${response.data.updated}\nCompleted: ${response.data.completed || 'Not completed'}`,
            },
          ],
        };
      }

      case 'create_task': {
        const validatedArgs = CreateTaskSchema.parse(args);
        const response = await tasks.tasks.insert({
          tasklist: validatedArgs.taskListId,
          parent: validatedArgs.parent,
          previous: validatedArgs.previous,
          requestBody: {
            title: validatedArgs.title,
            notes: validatedArgs.notes,
            due: validatedArgs.due,
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task created successfully:\nID: ${response.data.id}\nTitle: ${response.data.title}\nStatus: ${response.data.status}`,
            },
          ],
        };
      }

      case 'update_task': {
        const validatedArgs = UpdateTaskSchema.parse(args);

        const requestBody: any = {};
        if (validatedArgs.title) requestBody.title = validatedArgs.title;
        if (validatedArgs.notes !== undefined) requestBody.notes = validatedArgs.notes;
        if (validatedArgs.status) requestBody.status = validatedArgs.status;
        if (validatedArgs.due !== undefined) requestBody.due = validatedArgs.due;
        if (validatedArgs.completed) requestBody.completed = validatedArgs.completed;

        const response = await tasks.tasks.update({
          tasklist: validatedArgs.taskListId,
          task: validatedArgs.taskId,
          requestBody,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task updated successfully:\nID: ${response.data.id}\nTitle: ${response.data.title}\nStatus: ${response.data.status}`,
            },
          ],
        };
      }

      case 'delete_task': {
        const validatedArgs = DeleteTaskSchema.parse(args);
        await tasks.tasks.delete({
          tasklist: validatedArgs.taskListId,
          task: validatedArgs.taskId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task ${validatedArgs.taskId} deleted successfully`,
            },
          ],
        };
      }

      case 'move_task': {
        const validatedArgs = MoveTaskSchema.parse(args);
        const response = await tasks.tasks.move({
          tasklist: validatedArgs.taskListId,
          task: validatedArgs.taskId,
          parent: validatedArgs.parent,
          previous: validatedArgs.previous,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task moved successfully:\nID: ${response.data.id}\nTitle: ${response.data.title}`,
            },
          ],
        };
      }

      case 'clear_completed_tasks': {
        const validatedArgs = ClearCompletedTasksSchema.parse(args);
        await tasks.tasks.clear({
          tasklist: validatedArgs.taskListId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `All completed tasks cleared from task list ${validatedArgs.taskListId}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
}
