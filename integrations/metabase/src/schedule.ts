import { getMetabaseClient } from './utils';

interface MetabaseSettings {
  lastSyncTime?: string;
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function createActivityMessage(text: string, sourceURL: string) {
  return {
    type: 'activity',
    data: {
      text,
      sourceURL,
    },
  };
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>,
) {
  try {
    if (!config?.api_key || !config?.metabase_url) {
      return [];
    }

    const settings = (state || {}) as MetabaseSettings;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const lastSyncDate = new Date(lastSyncTime);

    const client = getMetabaseClient(config.metabase_url, config.api_key);
    const messages: any[] = [];

    try {
      const activityResponse = await client.get('/activity/');
      const activities = Array.isArray(activityResponse.data) ? activityResponse.data : [];

      for (const activity of activities) {
        try {
          const activityTime = new Date(activity.timestamp);
          if (activityTime <= lastSyncDate) continue;

          const modelName = activity.details?.name || String(activity.model_id || '');
          const user =
            activity.user?.first_name
              ? `${activity.user.first_name} ${activity.user.last_name}`.trim()
              : 'Someone';

          let text = '';
          let sourceURL = '';

          switch (activity.topic) {
            case 'dashboard-create':
              text = `${user} created dashboard: ${modelName}`;
              sourceURL = `${config.metabase_url}/dashboard/${activity.model_id}`;
              break;
            case 'dashboard-update':
              text = `${user} updated dashboard: ${modelName}`;
              sourceURL = `${config.metabase_url}/dashboard/${activity.model_id}`;
              break;
            case 'card-create':
              text = `${user} created question: ${modelName}`;
              sourceURL = `${config.metabase_url}/question/${activity.model_id}`;
              break;
            case 'card-update':
              text = `${user} updated question: ${modelName}`;
              sourceURL = `${config.metabase_url}/question/${activity.model_id}`;
              break;
            case 'collection-create':
              text = `${user} created collection: ${modelName}`;
              sourceURL = `${config.metabase_url}/collection/${activity.model_id}`;
              break;
            case 'database-sync-begin':
              text = `Database sync started for: ${modelName}`;
              sourceURL = `${config.metabase_url}/admin/databases/${activity.model_id}`;
              break;
            case 'database-sync-completed':
              text = `Database sync completed for: ${modelName}`;
              sourceURL = `${config.metabase_url}/admin/databases/${activity.model_id}`;
              break;
            case 'user-login':
              text = `${user} logged in to Metabase`;
              sourceURL = config.metabase_url;
              break;
            default:
              if (activity.topic && modelName) {
                text = `${user} performed ${activity.topic} on ${modelName}`;
                sourceURL = config.metabase_url;
              }
          }

          if (text && sourceURL) {
            messages.push(createActivityMessage(text, sourceURL));
          }
        } catch (_error) {
          // ignore individual activity errors
        }
      }
    } catch (_error) {
      // ignore activity fetch errors
    }

    const newSyncTime = new Date().toISOString();
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
      },
    });

    return messages;
  } catch (_error) {
    return [];
  }
}
