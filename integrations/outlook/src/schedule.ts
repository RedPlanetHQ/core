import { getGraphClient, OutlookConfig, formatEmailSender, parseEmailBody } from './utils';
import TurndownService from 'turndown';

interface OutlookSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  emailAddress?: string;
}

interface ActivityCreateParams {
  text: string;
  sourceURL: string;
}

function createActivityMessage(params: ActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

turndownService.remove(['style', 'script', 'noscript', 'iframe', 'object', 'embed']);

function cleanEmailContent(body: { contentType: string; content: string }): string {
  const content = parseEmailBody(body);
  if (!content) return '';

  if (body.contentType === 'html') {
    const markdown = turndownService.turndown(content);
    return markdown
      .replace(/\n\n+/g, '\n\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return content
    .replace(/\r/g, '')
    .replace(/\n\n+/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processReceivedEmails(client: any, lastSyncTime: string): Promise<any[]> {
  const activities = [];

  try {
    const response = await client.get('/me/mailFolders/inbox/messages', {
      params: {
        $filter: `receivedDateTime ge ${lastSyncTime}`,
        $orderby: 'receivedDateTime desc',
        $top: 50,
        $select: 'id,subject,from,receivedDateTime,body,webLink,isRead,importance',
      },
    });

    const messages = response.data.value || [];

    for (const message of messages) {
      try {
        const sender = formatEmailSender(message.from);
        const subject = message.subject || '(No subject)';
        const content = cleanEmailContent(message.body);

        if (!content || content.length < 10) continue;

        const sourceURL =
          message.webLink || `https://outlook.office365.com/mail/inbox/id/${message.id}`;

        const importanceTag = message.importance === 'high' ? ' [HIGH]' : '';

        const text = `## Email from ${sender}${importanceTag}

**Subject:** ${subject}

${content}`;

        activities.push(createActivityMessage({ text, sourceURL }));
      } catch (error) {
        console.error('Error processing received email:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching received emails:', error);
  }

  return activities;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processSentEmails(client: any, lastSyncTime: string): Promise<any[]> {
  const activities = [];

  try {
    const response = await client.get('/me/mailFolders/sentitems/messages', {
      params: {
        $filter: `sentDateTime ge ${lastSyncTime}`,
        $orderby: 'sentDateTime desc',
        $top: 50,
        $select: 'id,subject,toRecipients,sentDateTime,body,webLink',
      },
    });

    const messages = response.data.value || [];

    for (const message of messages) {
      try {
        const recipients = (message.toRecipients || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.emailAddress?.address || 'Unknown')
          .join(', ');
        const subject = message.subject || '(No subject)';
        const content = cleanEmailContent(message.body);

        if (!content || content.length < 10) continue;

        const sourceURL =
          message.webLink || `https://outlook.office365.com/mail/sentitems/id/${message.id}`;

        const text = `## Sent to ${recipients}

**Subject:** ${subject}

${content}`;

        activities.push(createActivityMessage({ text, sourceURL }));
      } catch (error) {
        console.error('Error processing sent email:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching sent emails:', error);
  }

  return activities;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processCalendarEvents(client: any, lastSyncTime: string): Promise<any[]> {
  const activities = [];

  try {
    const now = new Date();
    const endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead

    const response = await client.get('/me/calendarView', {
      params: {
        startDateTime: lastSyncTime,
        endDateTime: endTime.toISOString(),
        $top: 50,
        $select:
          'id,subject,start,end,location,organizer,attendees,webLink,isAllDay,bodyPreview,lastModifiedDateTime',
        $orderby: 'start/dateTime asc',
      },
    });

    const events = response.data.value || [];

    for (const event of events) {
      try {
        // Only include events created or modified since last sync
        if (event.lastModifiedDateTime && event.lastModifiedDateTime < lastSyncTime) continue;

        const subject = event.subject || '(No subject)';
        const startStr = event.start?.dateTime
          ? new Date(event.start.dateTime).toLocaleString()
          : 'TBD';
        const endStr = event.end?.dateTime
          ? new Date(event.end.dateTime).toLocaleString()
          : 'TBD';
        const location = event.location?.displayName || '';
        const organizer = event.organizer?.emailAddress?.name || '';
        const attendeeCount = event.attendees?.length || 0;

        const sourceURL =
          event.webLink || `https://outlook.office365.com/calendar/item/${event.id}`;

        let text = `## Calendar: ${subject}

**When:** ${startStr} - ${endStr}`;
        if (event.isAllDay) text += ' (All day)';
        if (location) text += `\n**Where:** ${location}`;
        if (organizer) text += `\n**Organizer:** ${organizer}`;
        if (attendeeCount > 0) text += `\n**Attendees:** ${attendeeCount}`;
        if (event.bodyPreview) text += `\n\n${event.bodyPreview}`;

        activities.push(createActivityMessage({ text, sourceURL }));
      } catch (error) {
        console.error('Error processing calendar event:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching calendar events:', error);
  }

  return activities;
}

export const handleSchedule = async (
  config?: Record<string, string>,
  state?: Record<string, string>
) => {
  try {
    if (!config?.access_token) {
      return [];
    }

    let settings = (state || {}) as OutlookSettings;

    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const outlookConfig: OutlookConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: config.client_id || '',
      client_secret: config.client_secret || '',
    };

    const client = await getGraphClient(outlookConfig);

    // Get user profile if not cached
    if (!settings.emailAddress) {
      try {
        const profile = await client.get('/me');
        settings.emailAddress = profile.data.mail || profile.data.userPrincipalName;
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    }

    const messages = [];

    // Process received emails
    const receivedActivities = await processReceivedEmails(client, lastSyncTime);
    messages.push(...receivedActivities);

    // Process sent emails
    const sentActivities = await processSentEmails(client, lastSyncTime);
    messages.push(...sentActivities);

    // Process calendar events
    const calendarActivities = await processCalendarEvents(client, lastSyncTime);
    messages.push(...calendarActivities);

    // Update state
    const newSyncTime = new Date().toISOString();
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
        lastUserEventTime: newSyncTime,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
