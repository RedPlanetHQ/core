import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

interface GoogleTasksConfig {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  redirect_uri?: string;
}

interface GoogleTasksSettings {
  lastSyncTime?: string;
  userEmail?: string;
}

interface TaskActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on Google Tasks data
 */
function createActivityMessage(params: TaskActivityCreateParams) {
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
 * Initialize Google Tasks client
 */
async function getTasksClient(config: GoogleTasksConfig) {
  const oauth2Client = new OAuth2Client(
    config.client_id,
    config.client_secret,
    config.redirect_uri
  );

  oauth2Client.setCredentials({
    access_token: config.access_token,
    refresh_token: config.refresh_token,
  });

  return google.tasks({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch and process tasks that were created or updated
 */
async function processTaskUpdates(
  tasks: any,
  lastSyncTime: string,
  syncStartedMs: number
): Promise<any[]> {
  const activities = [];
  const lastSyncMs = Date.parse(lastSyncTime);

  // Get all task lists with pagination
  const allTaskLists = [];
  let pageToken: string | undefined = undefined;

  do {
    const taskListsResponse = await tasks.tasklists.list({
      maxResults: 100,
      pageToken,
    });

    allTaskLists.push(...(taskListsResponse.data.items || []));
    pageToken = taskListsResponse.data.nextPageToken;
  } while (pageToken);

  for (const taskList of allTaskLists) {
    // Get tasks updated since last sync with pagination
    const allTasks = [];
    let taskPageToken: string | undefined = undefined;

    do {
      const tasksResponse = await tasks.tasks.list({
        tasklist: taskList.id,
        showCompleted: true,
        // Google hides tasks completed in its own clients.
        showHidden: true,
        updatedMin: lastSyncTime,
        maxResults: 100,
        pageToken: taskPageToken,
      });

      allTasks.push(...(tasksResponse.data.items || []));
      taskPageToken = tasksResponse.data.nextPageToken;
    } while (taskPageToken);

    for (const task of allTasks) {
      const taskUpdated = new Date(task.updated || '');
      const updatedMs = taskUpdated.getTime();
      if (!(updatedMs >= lastSyncMs && updatedMs < syncStartedMs)) {
        continue;
      }

      // Format task status
      const status = task.status === 'completed' ? '✅' : '📝';
      const statusText = task.status === 'completed' ? 'Completed' : 'Active';

      // Build task details
      let taskText = `## ${status} Task changed\n\n`;
      taskText += `**Task List:** ${taskList.title}\n`;
      taskText += `**Title:** ${task.title}\n`;
      taskText += `**Status:** ${statusText}\n`;

      if (task.due) {
        // Google Tasks stores only the calendar date in this RFC 3339 field.
        taskText += `**Due:** ${task.due.slice(0, 10)}\n`;
      }

      if (task.notes) {
        taskText += `\n**Notes:**\n${task.notes}\n`;
      }

      if (task.completed) {
        const completedDate = new Date(task.completed);
        taskText += `\n**Completed:** ${completedDate.toLocaleString()}\n`;
      }

      // Create Google Tasks web URL
      const sourceURL = `https://tasks.google.com/`;

      activities.push(
        createActivityMessage({
          text: taskText,
          sourceURL,
        })
      );
    }
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
    let settings = (state || {}) as GoogleTasksSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Create Tasks client
    const tasksConfig: GoogleTasksConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: config.client_id || '',
      client_secret: config.client_secret || '',
      redirect_uri: config.redirect_uri,
    };

    const tasksClient = await getTasksClient(tasksConfig);

    // Get user email if not already stored
    if (!settings.userEmail && config.userEmail) {
      settings.userEmail = config.userEmail;
    }

    // Collect all messages
    const messages = [];

    // Process task updates
    const taskActivities = await processTaskUpdates(tasksClient, lastSyncTime, syncStartedMs);
    messages.push(...taskActivities);

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
