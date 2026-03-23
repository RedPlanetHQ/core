interface CalendlyWebhookEvent {
  event: string;
  payload: {
    event_type?: { name?: string };
    invitee?: {
      name?: string;
      email?: string;
      cancel_url?: string;
      reschedule_url?: string;
    };
    scheduled_event?: {
      name?: string;
      start_time?: string;
      end_time?: string;
      uri?: string;
    };
    form_submission?: {
      questions_and_answers?: Array<{ question: string; answer: string }>;
    };
    routing_form?: { name?: string };
    cancel_url?: string;
    reschedule_url?: string;
  };
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function describeEvent(webhookEvent: CalendlyWebhookEvent): string | null {
  const { event, payload } = webhookEvent;
  const invitee = payload.invitee;
  const scheduled = payload.scheduled_event;
  const eventTypeName = payload.event_type?.name || scheduled?.name || 'meeting';
  const inviteeName = invitee?.name || invitee?.email || 'someone';
  const startTime = scheduled?.start_time;

  switch (event) {
    case 'invitee.created':
      return `${inviteeName} booked "${eventTypeName}"${startTime ? ` on ${formatTime(startTime)}` : ''}`;

    case 'invitee.canceled':
      return `${inviteeName} canceled "${eventTypeName}"${startTime ? ` (was ${formatTime(startTime)})` : ''}`;

    case 'routing_form_submission.created': {
      const formName = payload.routing_form?.name || 'routing form';
      return `New submission on "${formName}"`;
    }

    default:
      return null;
  }
}

function getSourceUrl(webhookEvent: CalendlyWebhookEvent): string {
  const { payload } = webhookEvent;
  const uri = payload.scheduled_event?.uri;
  if (uri) {
    // Extract UUID from URI like https://api.calendly.com/scheduled_events/<uuid>
    const uuid = uri.split('/').pop();
    return `https://calendly.com/scheduled_events/${uuid}`;
  }
  return 'https://calendly.com/app/scheduled_events';
}

export function createActivity(webhookEvent: CalendlyWebhookEvent) {
  const text = describeEvent(webhookEvent);
  if (!text) return null;

  return {
    type: 'activity',
    data: {
      text,
      sourceURL: getSourceUrl(webhookEvent),
    },
  };
}
