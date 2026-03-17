import { getMixpanelClient, getDataClient, MixpanelConfig, parseNDJSON, formatDate } from './utils';

interface MixpanelState {
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

async function syncEvents(
  config: MixpanelConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const dataClient = getDataClient(config);
    const from = formatDate(new Date(lastSyncTime));
    const to = formatDate(new Date());

    const response = await dataClient.get('/api/2.0/export', {
      params: {
        project_id: config.project_id,
        from_date: from,
        to_date: to,
        limit: 200,
      },
      responseType: 'text',
    });

    const events = parseNDJSON(response.data as string);
    const projectBase =
      config.region === 'EU'
        ? `https://eu.mixpanel.com/project/${config.project_id}`
        : `https://mixpanel.com/project/${config.project_id}`;

    for (const event of events.slice(0, 50)) {
      const eventName = (event['event'] as string) ?? 'unknown';
      const props = (event['properties'] as Record<string, unknown>) ?? {};
      const distinctId = (props['distinct_id'] as string) ?? 'N/A';
      const time = props['time']
        ? new Date((props['time'] as number) * 1000).toISOString()
        : 'N/A';

      const text = `## Event: ${eventName}

**User:** ${distinctId}
**Time:** ${time}
**Properties:** ${JSON.stringify(props, null, 2)}`;

      activities.push(createActivity(text, `${projectBase}/activity`));
    }
  } catch (error) {
    console.error('Error syncing Mixpanel events:', error);
  }

  return activities;
}

async function syncUserProfiles(
  config: MixpanelConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getMixpanelClient(config);
    const projectBase =
      config.region === 'EU'
        ? `https://eu.mixpanel.com/project/${config.project_id}`
        : `https://mixpanel.com/project/${config.project_id}`;

    const response = await client.get('/api/2.0/engage', {
      params: {
        project_id: config.project_id,
        page_size: 50,
      },
    });

    const profiles: Record<string, unknown>[] = (response.data?.results as Record<string, unknown>[]) ?? [];
    const since = new Date(lastSyncTime).getTime();

    for (const profile of profiles) {
      const props = (profile['$properties'] as Record<string, unknown>) ?? {};
      const lastSeen = props['$last_seen'] as string | undefined;
      if (lastSeen && new Date(lastSeen).getTime() < since) continue;

      const distinctId = (profile['$distinct_id'] as string) ?? 'N/A';
      const name = (props['$name'] as string) ?? (props['$email'] as string) ?? distinctId;
      const email = (props['$email'] as string) ?? 'N/A';

      const text = `## User Profile: ${name}

**Distinct ID:** ${distinctId}
**Email:** ${email}
**Last Seen:** ${lastSeen ?? 'N/A'}`;

      activities.push(createActivity(text, `${projectBase}/users/${encodeURIComponent(distinctId)}`));
    }
  } catch (error) {
    console.error('Error syncing Mixpanel user profiles:', error);
  }

  return activities;
}

async function syncFunnels(
  config: MixpanelConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getMixpanelClient(config);
    const projectBase =
      config.region === 'EU'
        ? `https://eu.mixpanel.com/project/${config.project_id}`
        : `https://mixpanel.com/project/${config.project_id}`;

    const from = formatDate(new Date(lastSyncTime));
    const to = formatDate(new Date());

    const listResponse = await client.get('/api/2.0/funnels/list', {
      params: { project_id: config.project_id },
    });

    const funnels: Record<string, unknown>[] = (listResponse.data as Record<string, unknown>[]) ?? [];

    for (const funnel of funnels.slice(0, 10)) {
      const funnelId = funnel['funnel_id'] as number;
      const funnelName = (funnel['name'] as string) ?? `Funnel ${funnelId}`;

      try {
        const dataResponse = await client.get('/api/2.0/funnels', {
          params: {
            project_id: config.project_id,
            funnel_id: funnelId,
            from_date: from,
            to_date: to,
          },
        });

        const data = dataResponse.data as Record<string, unknown>;
        const meta = (data['meta'] as Record<string, unknown>) ?? {};
        const steps: Record<string, unknown>[] = (meta['steps'] as Record<string, unknown>[]) ?? [];

        if (steps.length === 0) continue;

        const firstStep = steps[0];
        const lastStep = steps[steps.length - 1];
        const entryCount = (firstStep['count'] as number) ?? 0;
        const completionCount = (lastStep['count'] as number) ?? 0;
        const conversionRate =
          entryCount > 0 ? ((completionCount / entryCount) * 100).toFixed(1) : '0';

        const text = `## Funnel: ${funnelName}

**Steps:** ${steps.length}
**Entered:** ${entryCount}
**Completed:** ${completionCount}
**Conversion Rate:** ${conversionRate}%
**Period:** ${from} → ${to}`;

        activities.push(createActivity(text, `${projectBase}/funnels/${funnelId}`));
      } catch {
        // skip individual funnel errors
      }
    }
  } catch (error) {
    console.error('Error syncing Mixpanel funnels:', error);
  }

  return activities;
}

async function syncRetention(
  config: MixpanelConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getMixpanelClient(config);
    const projectBase =
      config.region === 'EU'
        ? `https://eu.mixpanel.com/project/${config.project_id}`
        : `https://mixpanel.com/project/${config.project_id}`;

    const from = formatDate(new Date(lastSyncTime));
    const to = formatDate(new Date());

    const response = await client.get('/api/2.0/retention', {
      params: {
        project_id: config.project_id,
        from_date: from,
        to_date: to,
        retention_type: 'birth',
        born_event: '$default',
        interval: 1,
        interval_count: 7,
        unit: 'day',
      },
    });

    const data = response.data as Record<string, unknown>;

    if (data && typeof data === 'object') {
      const cohorts = Object.entries(data);
      const summaries = cohorts.slice(0, 5).map(([date, cohort]) => {
        const cohortData = cohort as Record<string, unknown>;
        const counts = (cohortData['counts'] as number[]) ?? [];
        const initial = counts[0] ?? 0;
        const day7 = counts[6] ?? 0;
        const retentionRate = initial > 0 ? ((day7 / initial) * 100).toFixed(1) : '0';
        return `- **${date}**: ${initial} users, Day 7 retention: ${retentionRate}%`;
      });

      if (summaries.length > 0) {
        const text = `## User Retention Summary

**Period:** ${from} → ${to}

${summaries.join('\n')}`;

        activities.push(createActivity(text, `${projectBase}/retention`));
      }
    }
  } catch (error) {
    console.error('Error syncing Mixpanel retention:', error);
  }

  return activities;
}

async function syncAnnotations(
  config: MixpanelConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getMixpanelClient(config);
    const projectBase =
      config.region === 'EU'
        ? `https://eu.mixpanel.com/project/${config.project_id}`
        : `https://mixpanel.com/project/${config.project_id}`;

    const response = await client.get('/api/2.0/annotations', {
      params: { project_id: config.project_id },
    });

    const annotations: Record<string, unknown>[] =
      ((response.data as Record<string, unknown>)?.['results'] as Record<string, unknown>[]) ?? [];
    const since = new Date(lastSyncTime).getTime();

    for (const annotation of annotations) {
      const date = (annotation['date'] as string) ?? '';
      if (date && new Date(date).getTime() < since) continue;

      const note = (annotation['description'] as string) ?? 'N/A';
      const author = (annotation['login_name'] as string) ?? 'Unknown';

      const text = `## Annotation Added

**Note:** ${note}
**Date:** ${date || 'N/A'}
**Added by:** ${author}`;

      activities.push(createActivity(text, `${projectBase}/insights`));
    }
  } catch (error) {
    console.error('Error syncing Mixpanel annotations:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>
): Promise<unknown[]> {
  try {
    if (!config?.service_account_username || !config?.service_account_secret || !config?.project_id) {
      return [];
    }

    const mixpanelConfig = config as unknown as MixpanelConfig;
    if (!mixpanelConfig.region) {
      mixpanelConfig.region = 'US';
    }

    const settings = (state || {}) as MixpanelState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: unknown[] = [];

    const [eventActivities, profileActivities, funnelActivities, retentionActivities, annotationActivities] =
      await Promise.all([
        syncEvents(mixpanelConfig, lastSyncTime),
        syncUserProfiles(mixpanelConfig, lastSyncTime),
        syncFunnels(mixpanelConfig, lastSyncTime),
        syncRetention(mixpanelConfig, lastSyncTime),
        syncAnnotations(mixpanelConfig, lastSyncTime),
      ]);

    messages.push(
      ...eventActivities,
      ...profileActivities,
      ...funnelActivities,
      ...retentionActivities,
      ...annotationActivities
    );

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in Mixpanel handleSchedule:', error);
    return [];
  }
}
