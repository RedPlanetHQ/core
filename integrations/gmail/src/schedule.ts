import { getGmailClient, GmailConfig } from './utils';
import {
  formatMetadataText,
  getDefaultSyncTime,
  getHeader,
  GmailEmailMetadata,
  toGmailTimestamp,
} from './schedule-utils';

export { formatMetadataText, getDefaultSyncTime, GmailEmailMetadata, toGmailTimestamp };

interface GmailSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  emailAddress?: string;
}

interface GmailActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on Gmail metadata.
 */
function createActivityMessage(params: GmailActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Fetch and process received emails — returns metadata-only activities.
 */
async function processReceivedEmails(
  gmail: any,
  lastSyncTime: string
): Promise<{ activities: any[]; lastEmailTime: number }> {
  const activities = [];
  const afterTimestamp = toGmailTimestamp(lastSyncTime);
  let lastEmailTime = 0;

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox is:important after:${afterTimestamp}`,
      maxResults: 50,
    });

    const messages = response.data.messages || [];

    for (const message of messages) {
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'],
        });

        const data = fullMessage.data;
        const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];

        const internalDate = parseInt(data.internalDate || '0', 10);

        // Skip emails at or before lastSyncTime (Gmail after: is not precise at second level)
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const cc = getHeader(headers, 'Cc') || undefined;
        const bcc = getHeader(headers, 'Bcc') || undefined;

        const meta: GmailEmailMetadata = {
          id: data.id ?? message.id,
          threadId: data.threadId ?? '',
          ...(data.historyId ? { historyId: data.historyId } : {}),
          subject: getHeader(headers, 'Subject') || '(No subject)',
          from: getHeader(headers, 'From') || 'Unknown',
          to: getHeader(headers, 'To') || '',
          ...(cc ? { cc } : {}),
          ...(bcc ? { bcc } : {}),
          date: getHeader(headers, 'Date'),
          internalDate,
          snippet: data.snippet ?? '',
          labelIds: data.labelIds ?? [],
          sizeEstimate: data.sizeEstimate ?? 0,
          webLink: `https://mail.google.com/mail/u/0/#inbox/${data.id ?? message.id}`,
        };

        activities.push(
          createActivityMessage({
            text: formatMetadataText(meta, 'received'),
            sourceURL: meta.webLink,
          })
        );
      } catch (error) {
        console.error('Error processing received email:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching received emails:', error);
  }

  return { activities, lastEmailTime };
}

/**
 * Fetch and process sent emails — returns metadata-only activities.
 */
async function processSentEmails(
  gmail: any,
  lastSyncTime: string
): Promise<{ activities: any[]; lastEmailTime: number }> {
  const activities = [];
  const afterTimestamp = toGmailTimestamp(lastSyncTime);
  let lastEmailTime = 0;

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${afterTimestamp}`,
      maxResults: 50,
    });

    const messages = response.data.messages || [];

    for (const message of messages) {
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'],
        });

        const data = fullMessage.data;
        const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];

        const internalDate = parseInt(data.internalDate || '0', 10);

        // Skip emails at or before lastSyncTime
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const cc = getHeader(headers, 'Cc') || undefined;
        const bcc = getHeader(headers, 'Bcc') || undefined;

        const meta: GmailEmailMetadata = {
          id: data.id ?? message.id,
          threadId: data.threadId ?? message.id,
          ...(data.historyId ? { historyId: data.historyId } : {}),
          subject: getHeader(headers, 'Subject') || '(No subject)',
          from: getHeader(headers, 'From') || 'Unknown',
          to: getHeader(headers, 'To') || '',
          ...(cc ? { cc } : {}),
          ...(bcc ? { bcc } : {}),
          date: getHeader(headers, 'Date'),
          internalDate,
          snippet: data.snippet ?? '',
          labelIds: data.labelIds ?? [],
          sizeEstimate: data.sizeEstimate ?? 0,
          webLink: `https://mail.google.com/mail/u/0/#sent/${data.id ?? message.id}`,
        };

        activities.push(
          createActivityMessage({
            text: formatMetadataText(meta, 'sent'),
            sourceURL: meta.webLink,
          })
        );
      } catch (error) {
        console.error('Error processing sent email:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching sent emails:', error);
  }

  return { activities, lastEmailTime };
}

export const handleSchedule = async (
  config?: Record<string, string>,
  integrationDefinition?: any,
  state?: Record<string, string>
) => {
  try {
    if (!config?.access_token) {
      return [];
    }

    let settings = (state || {}) as GmailSettings;

    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const gmailConfig: GmailConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: integrationDefinition.config.clientId || '',
      client_secret: integrationDefinition.config.clientSecret || '',
    };

    const gmail = await getGmailClient(gmailConfig);

    if (!settings.emailAddress) {
      try {
        const profile = await gmail.users.getProfile({ userId: 'me' });
        settings.emailAddress = profile.data.emailAddress as string;
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    }

    const messages = [];

    const { activities: receivedActivities, lastEmailTime: receivedLastTime } =
      await processReceivedEmails(gmail, lastSyncTime);
    messages.push(...receivedActivities);

    const { activities: sentActivities, lastEmailTime: sentLastTime } = await processSentEmails(
      gmail,
      lastSyncTime
    );
    messages.push(...sentActivities);

    const latestEmailTime = Math.max(receivedLastTime, sentLastTime);
    if (latestEmailTime > 0) {
      const newSyncTime = new Date(latestEmailTime + 20000).toISOString();
      messages.push({
        type: 'state',
        data: {
          ...settings,
          lastSyncTime: newSyncTime,
          lastUserEventTime: newSyncTime,
        },
      });
    }

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
