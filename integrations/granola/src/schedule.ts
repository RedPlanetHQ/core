import { callGranolaToolRPC } from './utils';

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function parseMeetingContent(content: any[]): string {
  if (!content || content.length === 0) return '';
  return content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
}

interface Meeting {
  id?: string;
  title?: string;
  date?: string;
  attendees?: string[];
  url?: string;
  summary?: string;
}

function parseMeetingsFromContent(raw: string): Meeting[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.meetings) return parsed.meetings;
  } catch {
    // plain text response — not parseable as meetings list
  }
  return [];
}

export async function handleSchedule(
  config: Record<string, any>,
  state: Record<string, any>,
): Promise<any[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const activities: any[] = [];

  try {
    const listResult = await callGranolaToolRPC(config, 'list_meetings', {
      after: lastSyncTime,
    });

    const rawText = parseMeetingContent(listResult?.content ?? []);
    const meetings = parseMeetingsFromContent(rawText);

    for (const meeting of meetings) {
      const title = meeting.title || 'Untitled Meeting';
      const date = meeting.date ? new Date(meeting.date).toLocaleString() : '';
      const attendees = meeting.attendees?.join(', ') || '';

      const parts = [`Meeting: ${title}`];
      if (date) parts.push(`Date: ${date}`);
      if (attendees) parts.push(`Attendees: ${attendees}`);
      if (meeting.summary) parts.push(`Summary: ${meeting.summary}`);

      activities.push({
        type: 'activity',
        data: {
          text: parts.join('\n'),
          sourceURL: meeting.url ?? '',
        },
      });
    }
  } catch (error: any) {
    console.error('Granola schedule sync error:', error.message);
  }

  activities.push({
    type: 'state',
    data: { lastSyncTime: new Date().toISOString() },
  });

  return activities;
}
