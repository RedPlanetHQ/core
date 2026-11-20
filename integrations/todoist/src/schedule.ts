import { getTasks, TodoistConfig, formatPriority, formatDueDate } from './utils';

interface TodoistSettings {
  lastSyncTime?: string;
  userEmail?: string;
  importedAtOrAfterCheckpoint?: Record<string, number>;
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
 * Import new active tasks observed during the scan
 */
async function processNewTasks(
  config: TodoistConfig,
  lastSyncTime: string,
  syncStartedMs: number,
  previouslyImported: Record<string, number> = {}
) {
  const activities = [];
  const lastSyncMs = Date.parse(lastSyncTime);
  const importedTasks = new Map(Object.entries(previouslyImported));

  for (const task of await getTasks(config)) {
    const createdMs = Date.parse(task.added_at ?? task.created_at ?? '');
    if (!(createdMs >= lastSyncMs) || importedTasks.has(task.id)) {
      continue;
    }

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
      if (createdMs >= syncStartedMs) {
        importedTasks.set(task.id, createdMs);
      }
    } catch (error) {
      console.error('Error processing task:', error);
    }
  }

  // Keep only imported tasks that the next scan could encounter again.
  const importedAtOrAfterCheckpoint = Object.fromEntries(
    [...importedTasks].filter(([, createdMs]) => createdMs >= syncStartedMs)
  );
  return { activities, importedAtOrAfterCheckpoint };
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
  state?: Record<string, unknown>
) => {
  try {
    // Check if we have a valid access token
    if (!config?.access_token) {
      return [];
    }

    const syncStartedMs = Date.now();

    // Get settings or initialize if not present
    const settings = (state || {}) as TodoistSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Create Todoist config
    const todoistConfig: TodoistConfig = {
      access_token: config.access_token,
    };

    // Collect all messages
    const messages = [];

    // Process new tasks
    const { activities, importedAtOrAfterCheckpoint } = await processNewTasks(
      todoistConfig,
      lastSyncTime,
      syncStartedMs,
      settings.importedAtOrAfterCheckpoint
    );
    messages.push(...activities);

    // Process completed tasks
    const completedTaskActivities = await processCompletedTasks(todoistConfig, lastSyncTime);
    messages.push(...completedTaskActivities);

    // Revisit the scan window for tasks that were created after an earlier page was read.
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date(syncStartedMs).toISOString(),
        importedAtOrAfterCheckpoint,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
