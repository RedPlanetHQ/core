// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeEvent(eventType: string, data: Record<string, any>): string | null {
  switch (eventType) {
    case 'meeting.completed': {
      const parts = [`Meeting completed: ${data.title || 'Untitled'}`];
      if (data.duration) parts.push(`Duration: ${Math.round(data.duration / 60)} min`);
      if (data.recorded_by) parts.push(`Recorded by: ${data.recorded_by}`);
      return parts.join('\n');
    }
    case 'meeting.summary.completed': {
      const parts = [`Meeting summary ready: ${data.title || 'Untitled'}`];
      if (data.key_points) parts.push(`Key points: ${data.key_points}`);
      if (data.action_items) parts.push(`Action items: ${data.action_items}`);
      return parts.join('\n');
    }
    case 'meeting.transcript.completed':
      return `Meeting transcript ready: ${data.title || 'Untitled'}`;
    case 'recording.completed':
      return `Recording completed${data.title ? `: ${data.title}` : ''}`;
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createActivityEvent(eventData: any, _config: any) {
  const eventType: string = eventData?.event ?? eventData?.type ?? '';
  const data: Record<string, any> = eventData?.data ?? {};

  const text = describeEvent(eventType, data);
  if (!text) return [];

  return [
    {
      type: 'activity',
      data: {
        text,
        sourceURL: data.share_url ?? '',
      },
    },
  ];
}
