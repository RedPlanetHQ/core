import { getPostHogClient, PostHogConfig } from './utils';

interface PostHogState {
  lastSyncTime?: string;
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function createActivity(text: string, sourceURL: string) {
  return {
    type: 'activity',
    data: { text, sourceURL },
  };
}

async function syncFeatureFlags(
  client: ReturnType<typeof getPostHogClient>,
  projectId: string,
  host: string,
  lastSyncTime: string
): Promise<any[]> {
  const activities: any[] = [];

  try {
    const response = await client.get(`/api/projects/${projectId}/feature_flags/`, {
      params: { limit: 50 },
    });

    const flags = response.data.results || [];
    const since = new Date(lastSyncTime).getTime();

    for (const flag of flags) {
      const updatedAt = flag.created_at ? new Date(flag.created_at).getTime() : 0;
      if (updatedAt < since) continue;

      const status = flag.active ? 'enabled' : 'disabled';
      const rollout =
        flag.rollout_percentage != null ? `${flag.rollout_percentage}%` : 'condition-based';
      const sourceURL = `${host}/project/${projectId}/feature_flags/${flag.id}`;

      const text = `## Feature Flag: ${flag.name} (${flag.key})

**Status:** ${status}
**Rollout:** ${rollout}
**Description:** ${flag.name || 'N/A'}
**Flag ID:** ${flag.id}`;

      activities.push(createActivity(text, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing feature flags:', error);
  }

  return activities;
}

async function syncInsights(
  client: ReturnType<typeof getPostHogClient>,
  projectId: string,
  host: string,
  lastSyncTime: string
): Promise<any[]> {
  const activities: any[] = [];

  try {
    const response = await client.get(`/api/projects/${projectId}/insights/`, {
      params: { limit: 20, order: '-created_at' },
    });

    const insights = response.data.results || [];
    const since = new Date(lastSyncTime).getTime();

    for (const insight of insights) {
      const createdAt = insight.created_at ? new Date(insight.created_at).getTime() : 0;
      if (createdAt < since) continue;

      const sourceURL = `${host}/project/${projectId}/insights/${insight.short_id}`;
      const createdBy = insight.created_by?.first_name
        ? `${insight.created_by.first_name} ${insight.created_by.last_name || ''}`.trim()
        : 'Unknown';

      const text = `## New Insight: ${insight.name || 'Untitled'}

**Created by:** ${createdBy}
**Description:** ${insight.description || 'N/A'}
**Insight ID:** ${insight.short_id}`;

      activities.push(createActivity(text, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing insights:', error);
  }

  return activities;
}

async function syncAnnotations(
  client: ReturnType<typeof getPostHogClient>,
  projectId: string,
  host: string,
  lastSyncTime: string
): Promise<any[]> {
  const activities: any[] = [];

  try {
    const response = await client.get(`/api/projects/${projectId}/annotations/`, {
      params: { limit: 50 },
    });

    const annotations = response.data.results || [];
    const since = new Date(lastSyncTime).getTime();

    for (const annotation of annotations) {
      const createdAt = annotation.created_at ? new Date(annotation.created_at).getTime() : 0;
      if (createdAt < since) continue;

      const sourceURL = `${host}/project/${projectId}/annotations`;
      const author = annotation.created_by?.first_name || 'Unknown';

      const text = `## Annotation Added

**Content:** ${annotation.content || 'N/A'}
**Date:** ${annotation.date_marker || 'N/A'}
**Created by:** ${author}
**Annotation ID:** ${annotation.id}`;

      activities.push(createActivity(text, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing annotations:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>
): Promise<any[]> {
  try {
    if (!config?.api_key || !config?.project_id) {
      return [];
    }

    const posthogConfig = config as unknown as PostHogConfig;
    const client = getPostHogClient(posthogConfig.api_key, posthogConfig.host);
    const settings = (state || {}) as PostHogState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const { project_id, host } = posthogConfig;

    const messages: any[] = [];

    const [flagActivities, insightActivities, annotationActivities] = await Promise.all([
      syncFeatureFlags(client, project_id, host, lastSyncTime),
      syncInsights(client, project_id, host, lastSyncTime),
      syncAnnotations(client, project_id, host, lastSyncTime),
    ]);

    messages.push(...flagActivities, ...insightActivities, ...annotationActivities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in PostHog handleSchedule:', error);
    return [];
  }
}
