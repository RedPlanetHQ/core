import axios, { AxiosInstance } from 'axios';

export interface TodoistConfig {
  access_token: string;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  due?: {
    date: string;
    string: string;
    datetime?: string;
  };
  priority: number;
  is_completed: boolean;
  created_at: string;
  url: string;
}

export interface TodoistProject {
  id: string;
  name: string;
  color: string;
  is_favorite: boolean;
  url: string;
}

/**
 * Create an authenticated Todoist API client
 */
export function getTodoistClient(config: TodoistConfig): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.todoist.com/api/v1',
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Get all active tasks
 */
export async function getTasks(
  config: TodoistConfig,
  filters?: { project_id?: string }
): Promise<TodoistTask[]> {
  const client = getTodoistClient(config);
  const response = await client.get('/tasks', { params: filters });
  return response.data;
}

/**
 * Get a specific task by ID
 */
export async function getTask(config: TodoistConfig, taskId: string): Promise<TodoistTask> {
  const client = getTodoistClient(config);
  const response = await client.get(`/tasks/${taskId}`);
  return response.data;
}

/**
 * Create a new task
 */
export async function createTask(
  config: TodoistConfig,
  content: string,
  options?: {
    description?: string;
    project_id?: string;
    due_string?: string;
    due_date?: string;
    priority?: number;
    labels?: string[];
  }
): Promise<TodoistTask> {
  const client = getTodoistClient(config);
  const response = await client.post('/tasks', {
    content,
    ...options,
  });
  return response.data;
}

/**
 * Update a task
 */
export async function updateTask(
  config: TodoistConfig,
  taskId: string,
  updates: {
    content?: string;
    description?: string;
    due_string?: string;
    due_date?: string;
    priority?: number;
    labels?: string[];
  }
): Promise<TodoistTask> {
  const client = getTodoistClient(config);
  const response = await client.post(`/tasks/${taskId}`, updates);
  return response.data;
}

/**
 * Close (complete) a task
 */
export async function closeTask(config: TodoistConfig, taskId: string): Promise<void> {
  const client = getTodoistClient(config);
  await client.post(`/tasks/${taskId}/close`);
}

/**
 * Reopen a task
 */
export async function reopenTask(config: TodoistConfig, taskId: string): Promise<void> {
  const client = getTodoistClient(config);
  await client.post(`/tasks/${taskId}/reopen`);
}

/**
 * Delete a task
 */
export async function deleteTask(config: TodoistConfig, taskId: string): Promise<void> {
  const client = getTodoistClient(config);
  await client.delete(`/tasks/${taskId}`);
}

/**
 * Get all projects
 */
export async function getProjects(config: TodoistConfig): Promise<TodoistProject[]> {
  const client = getTodoistClient(config);
  const response = await client.get('/projects');
  return response.data;
}

/**
 * Get a specific project by ID
 */
export async function getProject(
  config: TodoistConfig,
  projectId: string
): Promise<TodoistProject> {
  const client = getTodoistClient(config);
  const response = await client.get(`/projects/${projectId}`);
  return response.data;
}

/**
 * Create a new project
 */
export async function createProject(
  config: TodoistConfig,
  name: string,
  options?: {
    color?: string;
    is_favorite?: boolean;
  }
): Promise<TodoistProject> {
  const client = getTodoistClient(config);
  const response = await client.post('/projects', {
    name,
    ...options,
  });
  return response.data;
}

/**
 * Update a project
 */
export async function updateProject(
  config: TodoistConfig,
  projectId: string,
  updates: {
    name?: string;
    color?: string;
    is_favorite?: boolean;
  }
): Promise<TodoistProject> {
  const client = getTodoistClient(config);
  const response = await client.post(`/projects/${projectId}`, updates);
  return response.data;
}

/**
 * Delete a project
 */
export async function deleteProject(config: TodoistConfig, projectId: string): Promise<void> {
  const client = getTodoistClient(config);
  await client.delete(`/projects/${projectId}`);
}

/**
 * Format priority for display
 */
export function formatPriority(priority: number): string {
  switch (priority) {
    case 4:
      return '🔴 P1 (Urgent)';
    case 3:
      return '🟠 P2 (High)';
    case 2:
      return '🟡 P3 (Medium)';
    case 1:
    default:
      return '⚪ P4 (Normal)';
  }
}

/**
 * Format due date for display
 */
export function formatDueDate(due?: { date: string; string: string; datetime?: string }): string {
  if (!due) return 'No due date';

  if (due.datetime) {
    return `Due: ${new Date(due.datetime).toLocaleString()}`;
  }

  return `Due: ${due.string}`;
}
