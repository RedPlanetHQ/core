import { callTool } from "./mcp";

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

function parseMeetingContent(content: any[]): string {
  if (!content || content.length === 0) return "";
  return content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

interface Meeting {
  id?: string;
  title?: string;
  date?: string;
  attendees?: string[];
  url?: string;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

function parseMeetingsFromContent(raw: string): Meeting[] {
  // Granola occasionally returns JSON; keep that path as a fallback.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.meetings) return parsed.meetings;
  } catch {
    // not JSON — fall through to XML parsing
  }

  const meetings: Meeting[] = [];
  const meetingRe = /<meeting\s+([^>]*)>([\s\S]*?)<\/meeting>/g;
  let m: RegExpExecArray | null;

  while ((m = meetingRe.exec(raw)) !== null) {
    const attrs = parseAttributes(m[1]);
    const body = m[2];

    const participantsMatch = body.match(
      /<known_participants>([\s\S]*?)<\/known_participants>/,
    );
    const attendees = participantsMatch
      ? participantsMatch[1]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : undefined;

    meetings.push({
      id: attrs.id,
      title: attrs.title,
      date: attrs.date,
      attendees,
      url: attrs.id ? `https://notes.granola.ai/d/${attrs.id}` : undefined,
    });
  }

  return meetings;
}

function createActivityMessage(params: { text: string; sourceURL: string }) {
  return {
    type: "activity",
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

function formatMeetingActivity(meeting: Meeting): string {
  const title = meeting.title || "Untitled Meeting";
  let text = `New meeting added: ${title}`;
  if (meeting.id) text += ` (id: ${meeting.id})`;
  return text;
}

function parseMeetingDate(s?: string): number {
  if (!s) return 0;
  // Normalize "GMT+5:30" → "GMT+0530" so Date.parse accepts it.
  const normalized = s.replace(
    /GMT([+-])(\d{1,2}):(\d{2})/,
    (_, sign, h, m) => `GMT${sign}${h.padStart(2, "0")}${m}`,
  );
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : 0;
}

export async function handleSchedule(
  config: Record<string, any>,
  state: Record<string, any>
): Promise<any[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const activities: any[] = [];
  let latestMeetingTime = 0;

  try {
    const listResult = await callTool("list_meetings", { after: lastSyncTime }, config);

    if (listResult.isError) {
      throw new Error(parseMeetingContent(listResult.content ?? []) || "list_meetings failed");
    }

    const rawText = parseMeetingContent(listResult?.content ?? []);
    const meetings = parseMeetingsFromContent(rawText);

    for (const meeting of meetings) {
      const meetingTime = parseMeetingDate(meeting.date);
      if (meetingTime > latestMeetingTime) {
        latestMeetingTime = meetingTime;
      }

      activities.push(
        createActivityMessage({
          text: formatMeetingActivity(meeting),
          sourceURL: meeting.url ?? "",
        })
      );
    }
  } catch (error: any) {
    console.error("Granola schedule sync error:", error.message);
  }

  // Only advance lastSyncTime and emit state when meetings were found (mirrors Gmail behavior)
  if (latestMeetingTime > 0) {
    activities.push({
      type: "state",
      data: { lastSyncTime: new Date(latestMeetingTime + 1000).toISOString() },
    });
  }

  return activities;
}
