import { type FathomMeeting, fetchAllPages, fathomGet, fathomRecorderName } from './utils';

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function handleSchedule(
  config: Record<string, string>,
  state: Record<string, string>,
): Promise<unknown[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const syncStartedAt = new Date().toISOString();
  const activities: unknown[] = [];

  try {
    const meetings = await fetchAllPages<FathomMeeting>(
      config.api_key,
      '/meetings',
      { created_after: lastSyncTime },
      Infinity,
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
      const recorder = fathomRecorderName(meeting.recorded_by);
      if (recorder) {
        parts.push('Recorded by: ' + recorder);
      }

      try {
        if (meeting.recording_id != null) {
          const response = await fathomGet(
            config.api_key,
            '/recordings/' + encodeURIComponent(meeting.recording_id) + '/summary',
          );
          if (response?.summary?.markdown_formatted) {
            parts.push(response.summary.markdown_formatted);
          }
        } else if (meeting.id) {
          const summary = await fathomGet(
            config.api_key,
            '/meetings/' + encodeURIComponent(meeting.id) + '/summary',
          );
          if (summary?.key_points) {
            parts.push('Key points: ' + summary.key_points);
          }
          if (summary?.action_items) {
            parts.push('Action items: ' + summary.action_items);
          }
        }
      } catch {
        // Summary may not be available yet.
      }

      activities.push({
        type: 'activity',
        data: {
          text: parts.join('\n'),
          sourceURL: meeting.share_url || meeting.url || '',
        },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fathom schedule sync error:', message);
    return [];
  }

  activities.push({
    type: 'state',
    data: { lastSyncTime: syncStartedAt },
  });

  return activities;
}
