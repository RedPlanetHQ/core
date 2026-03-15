import { getSentryClient, SentryConfig } from './utils';

interface SentryState {
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

async function syncIssues(
  client: ReturnType<typeof getSentryClient>,
  orgSlug: string,
  host: string,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const since = new Date(lastSyncTime).toISOString();
    const response = await client.get(`/api/0/organizations/${orgSlug}/issues/`, {
      params: {
        limit: 50,
        query: `firstSeen:>${since}`,
        sort: 'date',
      },
    });

    const issues: Array<{
      id: string;
      title: string;
      culprit: string;
      status: string;
      level: string;
      count: string;
      userCount: number;
      permalink: string;
      project: { slug: string };
      firstSeen: string;
    }> = response.data || [];

    for (const issue of issues) {
      const sourceURL =
        issue.permalink ||
        `${host}/organizations/${orgSlug}/issues/${issue.id}/`;

      const text = `## 🐛 New Sentry Issue: ${issue.title}

**Project:** ${issue.project?.slug ?? 'N/A'}
**Level:** ${issue.level}
**Status:** ${issue.status}
**Culprit:** ${issue.culprit || 'N/A'}
**Events:** ${issue.count}
**Users Affected:** ${issue.userCount}
**First Seen:** ${issue.firstSeen}
**Issue ID:** ${issue.id}`;

      activities.push(createActivity(text, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing Sentry issues:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>
): Promise<unknown[]> {
  try {
    if (!config?.auth_token || !config?.organization_slug) {
      return [];
    }

    const sentryConfig = config as unknown as SentryConfig;
    const client = getSentryClient(sentryConfig.auth_token, sentryConfig.host);
    const settings = (state || {}) as SentryState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: unknown[] = [];

    const issueActivities = await syncIssues(
      client,
      sentryConfig.organization_slug,
      sentryConfig.host,
      lastSyncTime
    );

    messages.push(...issueActivities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in Sentry handleSchedule:', error);
    return [];
  }
}
