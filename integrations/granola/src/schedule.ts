import { callGranolaToolRPC } from "./utils";

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

export async function handleSchedule(
  config: Record<string, any>,
  state: Record<string, any>
): Promise<any[]> {
  const lastSyncTime = state?.lastSyncTime ?? getDefaultSyncTime();
  const activities: any[] = [];
  let latestMeetingTime = 0;

  try {
    const listResult = await callGranolaToolRPC(config, "list_meetings", {
      after: lastSyncTime,
    });

    const rawText = parseMeetingContent(listResult?.content ?? []);
    const meetings = parseMeetingsFromContent(rawText);

    for (const meeting of meetings) {
      const meetingTime = meeting.date ? new Date(meeting.date).getTime() : 0;
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
