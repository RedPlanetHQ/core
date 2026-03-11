import { fetchAllPages, fathomGet } from './utils';

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

interface FathomMeeting {
  id: string;
  title?: string;
  created_at?: string;
  duration?: number;
  recorded_by?: string;
  share_url?: string;
}

export async function handleSchedule(
  config: Record<string, string>,
  state: Record<string, string>,
): Promise<unknown[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const activities: unknown[] = [];

  try {
    const meetings = await fetchAllPages<FathomMeeting>(
      config.api_key,
      '/meetings',
      {
        created_after: lastSyncTime,
        limit: 50,
      },
    );

    for (const meeting of meetings) {
      const title = meeting.title || 'Untitled Meeting';
      const parts = [`Meeting: ${title}`];

      if (meeting.created_at) {
        parts.push(`Date: ${new Date(meeting.created_at).toLocaleString()}`);
      }
      if (meeting.duration) {
        parts.push(`Duration: ${Math.round(meeting.duration / 60)} min`);
      }
      if (meeting.recorded_by) {
        parts.push(`Recorded by: ${meeting.recorded_by}`);
      }

      try {
        const summary = await fathomGet(
          config.api_key,
          `/meetings/${meeting.id}/summary`,
        );
        if (summary?.key_points) {
          parts.push(`Key points: ${summary.key_points}`);
        }
        if (summary?.action_items) {
          parts.push(`Action items: ${summary.action_items}`);
        }
      } catch {
        // Summary may not be available yet
      }

      activities.push({
        type: 'activity',
        data: {
          text: parts.join('\n'),
          sourceURL: meeting.share_url ?? '',
        },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fathom schedule sync error:', message);
  }

  activities.push({
    type: 'state',
    data: { lastSyncTime: new Date().toISOString() },
  });

  return activities;
}
