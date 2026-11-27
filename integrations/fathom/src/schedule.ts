import {
  type FathomMeeting,
  fetchAllPages,
  fathomGet,
  fathomRecorderName,
  isFathomRateLimited,
} from './utils';

const INITIAL_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function handleSchedule(
  config: Record<string, string>,
  state: Record<string, string>,
): Promise<unknown[]> {
  const windowEnd = Date.now();
  const savedCheckpoint = Date.parse(state?.lastSyncTime ?? '');
  const windowStart = Number.isNaN(savedCheckpoint)
    ? windowEnd - INITIAL_SYNC_LOOKBACK_MS
    : savedCheckpoint;
  if (windowStart >= windowEnd) return [];

  const cutoff = new Date(windowEnd).toISOString();
  const activities: unknown[] = [];

  try {
    // The API filters strictly after the lower bound. Include the boundary
    // millisecond in the fetch and apply [windowStart, windowEnd) locally.
    const meetings = await fetchAllPages<FathomMeeting>(
      config.api_key,
      '/meetings',
      {
        created_after: new Date(windowStart - 1).toISOString(),
        created_before: cutoff,
        include_summary: true,
      },
      Infinity,
    );

    for (const meeting of meetings) {
      const createdAt = Date.parse(meeting.created_at ?? '');
      if (createdAt < windowStart || createdAt >= windowEnd) continue;

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
        parts.push(`Recorded by: ${recorder}`);
      }

      const summary = meeting.default_summary?.markdown_formatted;
      if (summary) {
        parts.push(summary);
      } else if (meeting.recording_id == null && meeting.id) {
        try {
          const legacySummary = await fathomGet(
            config.api_key,
            `/meetings/${encodeURIComponent(meeting.id)}/summary`,
          );
          if (legacySummary?.key_points) {
            parts.push(`Key points: ${legacySummary.key_points}`);
          }
          if (legacySummary?.action_items) {
            parts.push(`Action items: ${legacySummary.action_items}`);
          }
        } catch (error) {
          if (isFathomRateLimited(error)) throw error;
          // Legacy meetings can be returned before a summary is available.
        }
      }

      const recordingId = meeting.recording_id ?? meeting.id;
      activities.push({
        type: 'activity',
        data: {
          text: parts.join('\n'),
          sourceURL: meeting.share_url || meeting.url || '',
          ...(recordingId != null ? { sourceActivityId: String(recordingId) } : {}),
        },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fathom schedule sync error:', message);
    return [];
  }

  activities.push({ type: 'state', data: { lastSyncTime: cutoff } });
  return activities;
}
