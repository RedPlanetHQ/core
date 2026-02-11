import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  closeTask,
  reopenTask,
  deleteTask,
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  TodoistConfig,
  formatPriority,
  formatDueDate,
} from '../utils';

// Schema definitions
const GetTasksSchema = z.object({
  project_id: z.string().optional().describe('Filter tasks by project ID'),
});

const GetTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to retrieve'),
});

const CreateTaskSchema = z.object({
  content: z.string().describe('Task content/title'),
  description: z.string().optional().describe('Task description'),
  project_id: z.string().optional().describe('Project ID to add the task to'),
  due_string: z
    .string()
    .optional()
    .describe('Human-readable due date (e.g., "tomorrow", "next Monday")'),
  due_date: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  priority: z.number().min(1).max(4).optional().describe('Priority from 1 (normal) to 4 (urgent)'),
  labels: z.array(z.string()).optional().describe('Array of label names'),
});

const UpdateTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to update'),
  content: z.string().optional().describe('New task content/title'),
  description: z.string().optional().describe('New task description'),
  due_string: z.string().optional().describe('New human-readable due date'),
  due_date: z.string().optional().describe('New due date in YYYY-MM-DD format'),
  priority: z
    .number()
    .min(1)
    .max(4)
    .optional()
    .describe('New priority from 1 (normal) to 4 (urgent)'),
  labels: z.array(z.string()).optional().describe('New array of label names'),
});

const CloseTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to complete'),
});

const ReopenTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to reopen'),
});

const DeleteTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to delete'),
});

const ListProjectsSchema = z.object({}).describe('Retrieves all projects');

const GetProjectSchema = z.object({
  projectId: z.string().describe('ID of the project to retrieve'),
});

const CreateProjectSchema = z.object({
  name: z.string().describe('Project name'),
  color: z.string().optional().describe('Project color'),
  is_favorite: z.boolean().optional().describe('Whether the project is a favorite'),
});

const UpdateProjectSchema = z.object({
  projectId: z.string().describe('ID of the project to update'),
  name: z.string().optional().describe('New project name'),
  color: z.string().optional().describe('New project color'),
  is_favorite: z.boolean().optional().describe('Whether the project is a favorite'),
});

const DeleteProjectSchema = z.object({
  projectId: z.string().describe('ID of the project to delete'),
});

/**
 * Get list of available tools without starting the MCP server
 */
export async function getTools() {
  const tools = [
    {
      name: 'get_tasks',
      description: 'Retrieves all active tasks, optionally filtered by project',
      inputSchema: zodToJsonSchema(GetTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_task',
      description: 'Retrieves a specific task by ID',
      inputSchema: zodToJsonSchema(GetTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_task',
      description: 'Creates a new task',
      inputSchema: zodToJsonSchema(CreateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_task',
      description: 'Updates an existing task',
      inputSchema: zodToJsonSchema(UpdateTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'close_task',
      description: 'Marks a task as complete',
      inputSchema: zodToJsonSchema(CloseTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'reopen_task',
      description: 'Reopens a completed task',
      inputSchema: zodToJsonSchema(ReopenTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'delete_task',
      description: 'Permanently deletes a task',
      inputSchema: zodToJsonSchema(DeleteTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'list_projects',
      description: 'Retrieves all projects',
      inputSchema: zodToJsonSchema(ListProjectsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_project',
      description: 'Retrieves a specific project by ID',
      inputSchema: zodToJsonSchema(GetProjectSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_project',
      description: 'Creates a new project',
      inputSchema: zodToJsonSchema(CreateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'update_project',
      description: 'Updates an existing project',
      inputSchema: zodToJsonSchema(UpdateProjectSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'delete_project',
      description: 'Permanently deletes a project',
      inputSchema: zodToJsonSchema(DeleteProjectSchema),
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
  credentials: Record<string, string>
) {
  // Create Todoist config
  const config: TodoistConfig = {
    access_token: credentials.access_token,
  };

  try {
    switch (name) {
      case 'get_tasks': {
        const validatedArgs = GetTasksSchema.parse(args);
        const tasks = await getTasks(
          config,
          validatedArgs.project_id ? { project_id: validatedArgs.project_id } : undefined
        );

        const tasksText = tasks
          .map(task => {
            const priority = formatPriority(task.priority);
            const dueDate = formatDueDate(task.due);
            return `ID: ${task.id}\nContent: ${task.content}\nPriority: ${priority}\n${dueDate}\nURL: ${task.url}\n`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text:
                tasks.length > 0
                  ? `Found ${tasks.length} tasks:\n\n${tasksText}`
                  : 'No tasks found.',
            },
          ],
        };
      }

      case 'get_task': {
        const validatedArgs = GetTaskSchema.parse(args);
        const task = await getTask(config, validatedArgs.taskId);

        const priority = formatPriority(task.priority);
        const dueDate = formatDueDate(task.due);

        return {
          content: [
            {
              type: 'text',
              text: `Task Details:\nID: ${task.id}\nContent: ${task.content}\nDescription: ${task.description || 'N/A'}\nPriority: ${priority}\n${dueDate}\nProject ID: ${task.project_id}\nURL: ${task.url}`,
            },
          ],
        };
      }

      case 'create_task': {
        const validatedArgs = CreateTaskSchema.parse(args);
        const task = await createTask(config, validatedArgs.content, {
          description: validatedArgs.description,
          project_id: validatedArgs.project_id,
          due_string: validatedArgs.due_string,
          due_date: validatedArgs.due_date,
          priority: validatedArgs.priority,
          labels: validatedArgs.labels,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task created successfully:\nID: ${task.id}\nContent: ${task.content}\nURL: ${task.url}`,
            },
          ],
        };
      }

      case 'update_task': {
        const validatedArgs = UpdateTaskSchema.parse(args);
        const task = await updateTask(config, validatedArgs.taskId, {
          content: validatedArgs.content,
          description: validatedArgs.description,
          due_string: validatedArgs.due_string,
          due_date: validatedArgs.due_date,
          priority: validatedArgs.priority,
          labels: validatedArgs.labels,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Task updated successfully:\nID: ${task.id}\nContent: ${task.content}`,
            },
          ],
        };
      }

      case 'close_task': {
        const validatedArgs = CloseTaskSchema.parse(args);
        await closeTask(config, validatedArgs.taskId);

        return {
          content: [
            {
              type: 'text',
              text: `Task ${validatedArgs.taskId} completed successfully`,
            },
          ],
        };
      }

      case 'reopen_task': {
        const validatedArgs = ReopenTaskSchema.parse(args);
        await reopenTask(config, validatedArgs.taskId);

        return {
          content: [
            {
              type: 'text',
              text: `Task ${validatedArgs.taskId} reopened successfully`,
            },
          ],
        };
      }

      case 'delete_task': {
        const validatedArgs = DeleteTaskSchema.parse(args);
        await deleteTask(config, validatedArgs.taskId);

        return {
          content: [
            {
              type: 'text',
              text: `Task ${validatedArgs.taskId} deleted successfully`,
            },
          ],
        };
      }

      case 'list_projects': {
        const projects = await getProjects(config);

        const projectsText = projects
          .map(
            project =>
              `ID: ${project.id}\nName: ${project.name}\nColor: ${project.color}\nFavorite: ${project.is_favorite}\nURL: ${project.url}\n`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text:
                projects.length > 0
                  ? `Found ${projects.length} projects:\n\n${projectsText}`
                  : 'No projects found.',
            },
          ],
        };
      }

      case 'get_project': {
        const validatedArgs = GetProjectSchema.parse(args);
        const project = await getProject(config, validatedArgs.projectId);

        return {
          content: [
            {
              type: 'text',
              text: `Project Details:\nID: ${project.id}\nName: ${project.name}\nColor: ${project.color}\nFavorite: ${project.is_favorite}\nURL: ${project.url}`,
            },
          ],
        };
      }

      case 'create_project': {
        const validatedArgs = CreateProjectSchema.parse(args);
        const project = await createProject(config, validatedArgs.name, {
          color: validatedArgs.color,
          is_favorite: validatedArgs.is_favorite,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Project created successfully:\nID: ${project.id}\nName: ${project.name}\nURL: ${project.url}`,
            },
          ],
        };
      }

      case 'update_project': {
        const validatedArgs = UpdateProjectSchema.parse(args);
        const project = await updateProject(config, validatedArgs.projectId, {
          name: validatedArgs.name,
          color: validatedArgs.color,
          is_favorite: validatedArgs.is_favorite,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Project updated successfully:\nID: ${project.id}\nName: ${project.name}`,
            },
          ],
        };
      }

      case 'delete_project': {
        const validatedArgs = DeleteProjectSchema.parse(args);
        await deleteProject(config, validatedArgs.projectId);

        return {
          content: [
            {
              type: 'text',
              text: `Project ${validatedArgs.projectId} deleted successfully`,
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
