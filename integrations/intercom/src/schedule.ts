import { getIntercomClient, IntercomConfig } from './utils';
import { createActivity } from './create-activity';

interface IntercomState {
  lastSyncTime?: string;
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function timestampToIso(ts: number | null | undefined): string | null {
  if (!ts) {
    return null;
  }
  return new Date(ts * 1000).toISOString();
}

async function syncConversations(
  client: ReturnType<typeof getIntercomClient>,
  lastSyncTime: string,
): Promise<any[]> {
  const activities: any[] = [];

  try {
    const sinceTs = Math.floor(new Date(lastSyncTime).getTime() / 1000);

    // Search for conversations updated since the last sync
    const response = await client.post('/conversations/search', {
      query: {
        operator: 'AND',
        value: [
          {
            field: 'updated_at',
            operator: '>',
            value: sinceTs,
          },
        ],
      },
      pagination: { per_page: 50 },
    });

    const conversations: any[] = response.data?.conversations ?? [];

    for (const conversation of conversations) {
      const updatedAt = timestampToIso(conversation.updated_at);
      if (!updatedAt || updatedAt <= lastSyncTime) {
        continue;
      }

      const contactName =
        conversation.source?.author?.name ||
        conversation.source?.author?.email ||
        'Unknown contact';

      const subject = conversation.source?.subject || '(no subject)';
      const body = conversation.source?.body
        ? conversation.source.body.replace(/<[^>]*>/g, '').substring(0, 200)
        : '';

      const state = conversation.state ?? 'unknown';
      const assigneeName =
        conversation.assignee?.name || conversation.assignee?.email || 'Unassigned';

      const sourceURL = `https://app.intercom.com/a/inbox/${conversation.app_id ?? ''}/conversations/${conversation.id}`;

      const text = `## Intercom Conversation: ${subject}

**Contact:** ${contactName}
**State:** ${state}
**Assignee:** ${assigneeName}
**Updated:** ${updatedAt}
${body ? `\n**Message preview:** ${body}` : ''}
**Conversation ID:** ${conversation.id}`;

      activities.push(createActivity({ text, sourceURL }));
    }
  } catch (error) {
    console.error('Error syncing Intercom conversations:', error);
  }

  return activities;
}

async function syncContacts(
  client: ReturnType<typeof getIntercomClient>,
  lastSyncTime: string,
): Promise<any[]> {
  const activities: any[] = [];

  try {
    const sinceTs = Math.floor(new Date(lastSyncTime).getTime() / 1000);

    const response = await client.post('/contacts/search', {
      query: {
        operator: 'AND',
        value: [
          {
            field: 'updated_at',
            operator: '>',
            value: sinceTs,
          },
        ],
      },
      pagination: { per_page: 50 },
    });

    const contacts: any[] = response.data?.data ?? [];

    for (const contact of contacts) {
      const updatedAt = timestampToIso(contact.updated_at);
      if (!updatedAt || updatedAt <= lastSyncTime) {
        continue;
      }

      const name = contact.name || contact.email || 'Unknown';
      const email = contact.email ?? 'N/A';
      const role = contact.role ?? 'N/A';
      const createdAt = timestampToIso(contact.created_at) ?? 'N/A';

      const sourceURL = `https://app.intercom.com/a/contacts/${contact.id}`;

      const text = `## Intercom Contact: ${name}

**Email:** ${email}
**Role:** ${role}
**Created:** ${createdAt}
**Updated:** ${updatedAt}
**Contact ID:** ${contact.id}`;

      activities.push(createActivity({ text, sourceURL }));
    }
  } catch (error) {
    console.error('Error syncing Intercom contacts:', error);
  }

  return activities;
}

async function syncEvents(
  client: ReturnType<typeof getIntercomClient>,
  lastSyncTime: string,
): Promise<any[]> {
  const activities: any[] = [];

  try {
    // Fetch recently updated contacts to get their events
    const sinceTs = Math.floor(new Date(lastSyncTime).getTime() / 1000);

    const contactsResponse = await client.post('/contacts/search', {
      query: {
        operator: 'AND',
        value: [
          {
            field: 'updated_at',
            operator: '>',
            value: sinceTs,
          },
        ],
      },
      pagination: { per_page: 20 },
    });

    const contacts: any[] = contactsResponse.data?.data ?? [];

    for (const contact of contacts) {
      try {
        const eventsResponse = await client.get(`/events`, {
          params: {
            type: 'user',
            intercom_user_id: contact.id,
            per_page: 10,
          },
        });

        const events: any[] = eventsResponse.data?.events ?? [];

        for (const event of events) {
          const createdAt = timestampToIso(event.created_at);
          if (!createdAt || createdAt <= lastSyncTime) {
            continue;
          }

          const contactName = contact.name || contact.email || contact.id;
          const sourceURL = `https://app.intercom.com/a/contacts/${contact.id}`;

          const text = `## Intercom Event: ${event.event_name}

**Contact:** ${contactName}
**Event:** ${event.event_name}
**Occurred:** ${createdAt}
**Contact ID:** ${contact.id}`;

          activities.push(createActivity({ text, sourceURL }));
        }
      } catch (_err) {
        // Skip if events are not accessible for this contact
      }
    }
  } catch (error) {
    console.error('Error syncing Intercom events:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>,
): Promise<any[]> {
  try {
    if (!config?.access_token) {
      return [];
    }

    const intercomConfig = config as unknown as IntercomConfig;
    const client = getIntercomClient(intercomConfig.access_token);
    const settings = (state || {}) as IntercomState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: any[] = [];

    const [conversationActivities, contactActivities, eventActivities] = await Promise.all([
      syncConversations(client, lastSyncTime),
      syncContacts(client, lastSyncTime),
      syncEvents(client, lastSyncTime),
    ]);

    messages.push(...conversationActivities, ...contactActivities, ...eventActivities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in Intercom handleSchedule:', error);
    return [];
  }
}

