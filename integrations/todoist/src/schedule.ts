import { getTasks, TodoistConfig, formatPriority, formatDueDate } from './utils';

interface TodoistSettings {
  lastSyncTime?: string;
  userEmail?: string;
}

interface TodoistActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on Todoist data
 */
function createActivityMessage(params: TodoistActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fetch tasks created within the current sync window
 */
async function processNewTasks(
  config: TodoistConfig,
  lastSyncTime: string,
  syncStartedMs: number
): Promise<any[]> {
  const activities = [];

  // Get all active tasks
  const tasks = await getTasks(config);

  const lastSyncMs = Date.parse(lastSyncTime);
  const newTasks = tasks.filter(task => {
    const createdMs = Date.parse(task.added_at ?? task.created_at ?? '');
    return createdMs >= lastSyncMs && createdMs < syncStartedMs;
  });

  for (const task of newTasks) {
    try {
      // Format task information
      const priority = formatPriority(task.priority);
      const dueDate = formatDueDate(task.due);

      // Create markdown content for the task
      let text = `## ✅ New Task: ${task.content}\n\n`;

      if (task.description) {
        text += `**Description:** ${task.description}\n\n`;
      }

      text += `**Priority:** ${priority}\n`;
      text += `**${dueDate}**\n`;

      activities.push(
        createActivityMessage({
          text,
          sourceURL: task.url ?? `https://app.todoist.com/app/task/${task.id}`,
        })
      );
    } catch (error) {
      console.error('Error processing task:', error);
    }
  }

  return activities;
}

/**
 * Fetch and process completed tasks since last sync
 */
async function processCompletedTasks(config: TodoistConfig, lastSyncTime: string): Promise<any[]> {
  const activities = [];

  try {
    // Note: Todoist REST API v2 doesn't directly support filtering by completion time
    // This is a simplified implementation that would need to use Sync API for full functionality
    // For now, we'll skip completed tasks in the basic implementation
    // To properly implement this, you would need to:
    // 1. Use the Sync API v9 with completed items endpoint
    // 2. Or maintain a local state of task IDs and compare
  } catch (error) {
    console.error('Error fetching completed tasks:', error);
  }

  return activities;
}

export const handleSchedule = async (
  config?: Record<string, string>,
  state?: Record<string, string>
) => {
  try {
    // Check if we have a valid access token
    if (!config?.access_token) {
      return [];
    }

    const syncStartedMs = Date.now();

    // Get settings or initialize if not present
    let settings = (state || {}) as TodoistSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Create Todoist config
    const todoistConfig: TodoistConfig = {
      access_token: config.access_token,
    };

    // Collect all messages
    const messages = [];

    // Process new tasks
    const newTaskActivities = await processNewTasks(todoistConfig, lastSyncTime, syncStartedMs);
    messages.push(...newTaskActivities);

    // Process completed tasks
    const completedTaskActivities = await processCompletedTasks(todoistConfig, lastSyncTime);
    messages.push(...completedTaskActivities);

    // Changes at or after the start of this scan belong to the next run.
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date(syncStartedMs).toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
