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
 * Fetch and process tasks created or updated since last sync
 */
async function processNewTasks(config: TodoistConfig, lastSyncTime: string): Promise<any[]> {
  const activities = [];

  try {
    // Get all active tasks
    const tasks = await getTasks(config);

    // Filter tasks created or updated since last sync
    const lastSyncDate = new Date(lastSyncTime);
    const newTasks = tasks.filter(task => {
      const createdDate = new Date(task.created_at);
      return createdDate > lastSyncDate;
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
            sourceURL: task.url,
          })
        );
      } catch (error) {
        console.error('Error processing task:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching tasks:', error);
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
    const newTaskActivities = await processNewTasks(todoistConfig, lastSyncTime);
    messages.push(...newTaskActivities);

    // Process completed tasks
    const completedTaskActivities = await processCompletedTasks(todoistConfig, lastSyncTime);
    messages.push(...completedTaskActivities);

    // Update last sync time
    const newSyncTime = new Date().toISOString();

    // Add state message for saving settings
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
