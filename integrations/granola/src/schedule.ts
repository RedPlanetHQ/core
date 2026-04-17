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
  notes?: string;
  transcript?: string;
  action_items?: string[];
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

function parseMeetingDetail(raw: string): Partial<Meeting> {
  try {
    return JSON.parse(raw);
  } catch {
    return { notes: raw };
  }
}

async function fetchMeetingDetail(
  config: Record<string, any>,
  meetingId: string,
): Promise<Partial<Meeting>> {
  try {
    const result = await callGranolaToolRPC(config, 'get_meeting', { id: meetingId });
    const rawText = parseMeetingContent(result?.content ?? []);
    return parseMeetingDetail(rawText);
  } catch {
    return {};
  }
}

function formatMeetingActivity(meeting: Meeting, detail: Partial<Meeting>): string {
  const title = meeting.title || 'Untitled Meeting';
  const date = meeting.date ? new Date(meeting.date).toLocaleString() : '';
  const attendees = (meeting.attendees ?? []).join(', ');

  const lines: string[] = [`## Meeting: ${title}`];

  if (date) lines.push(`**Date:** ${date}`);
  if (attendees) lines.push(`**Attendees:** ${attendees}`);

  const notes = detail.notes ?? meeting.summary;
  if (notes) {
    lines.push('');
    lines.push('### Notes');
    lines.push(notes);
  }

  const actionItems = detail.action_items ?? [];
  if (actionItems.length > 0) {
    lines.push('');
    lines.push('### Action Items');
    for (const item of actionItems) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

export async function handleSchedule(
  config: Record<string, any>,
  state: Record<string, any>,
): Promise<any[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const activities: any[] = [];
  let latestMeetingTime = 0;

  try {
    const listResult = await callGranolaToolRPC(config, 'list_meetings', {
      after: lastSyncTime,
    });

    const rawText = parseMeetingContent(listResult?.content ?? []);
    const meetings = parseMeetingsFromContent(rawText);

    for (const meeting of meetings) {
      const meetingTime = meeting.date ? new Date(meeting.date).getTime() : 0;
      if (meetingTime > latestMeetingTime) {
        latestMeetingTime = meetingTime;
      }

      const detail = meeting.id ? await fetchMeetingDetail(config, meeting.id) : {};
      const text = formatMeetingActivity(meeting, detail);

      activities.push({
        type: 'activity',
        data: {
          text,
          sourceURL: meeting.url ?? '',
        },
      });
    }
  } catch (error: any) {
    console.error('Granola schedule sync error:', error.message);
  }

  // Only advance lastSyncTime if we actually found meetings (mirrors Gmail behavior)
  const newSyncTime =
    latestMeetingTime > 0
      ? new Date(latestMeetingTime + 1000).toISOString()
      : new Date().toISOString();

  activities.push({
    type: 'state',
    data: { lastSyncTime: newSyncTime },
  });

  return activities;
}
