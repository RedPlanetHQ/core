import { getGmailClient, formatEmailSender, GmailConfig } from './utils';

interface GmailSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  emailAddress?: string;
}

/**
 * Metadata-only representation of a scheduled Gmail email activity.
 * No message body or raw content is included.
 */
export interface GmailScheduledEmailMetadata {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  internalDate: number;
  snippet: string;
  labelIds: string[];
  sourceURL: string;
}

/**
 * Creates an activity message containing only email metadata (no body/text)
 */
function createActivityMessage(metadata: GmailScheduledEmailMetadata) {
  const lines = [
    `**From:** ${metadata.from}`,
    `**To:** ${metadata.to}`,
    `**Subject:** ${metadata.subject}`,
    `**Date:** ${metadata.date}`,
    `**Thread ID:** ${metadata.threadId}`,
    `**Labels:** ${metadata.labelIds.join(', ')}`,
    `**Snippet:** ${metadata.snippet}`,
  ];

  return {
    type: 'activity',
    data: {
      text: lines.join('\n'),
      sourceURL: metadata.sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Convert ISO date to Gmail query format as Unix timestamp in seconds
 * Using timestamp is more precise than YYYY/MM/DD which truncates to day
 */
function toGmailTimestamp(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

/**
 * Fetch and process received emails — metadata only, no body parts
 */
async function processReceivedEmails(
  gmail: any,
  lastSyncTime: string,
  emailAddress: string
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
        // Fetch metadata only — no body parts returned
        const metaMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = metaMessage.data.payload?.headers ?? [];
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
        const to = headers.find((h: any) => h.name === 'To')?.value || emailAddress;
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        const internalDate = parseInt(metaMessage.data.internalDate || '0');
        const snippet = metaMessage.data.snippet || '';
        const labelIds: string[] = metaMessage.data.labelIds || [];
        const threadId: string = metaMessage.data.threadId || '';

        // Skip emails at or before lastSyncTime
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const sender = formatEmailSender(from);
        const sourceURL = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;

        const metadata: GmailScheduledEmailMetadata = {
          id: message.id,
          threadId,
          subject,
          from,
          to,
          date,
          internalDate,
          snippet,
          labelIds,
          sourceURL,
        };

        activities.push(createActivityMessage(metadata));
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
 * Fetch and process sent emails — metadata only, no body parts
 */
async function processSentEmails(
  gmail: any,
  lastSyncTime: string,
  emailAddress: string
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
        // Fetch metadata only — no body parts returned
        const metaMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = metaMessage.data.payload?.headers ?? [];
        const to = headers.find((h: any) => h.name === 'To')?.value || 'Unknown';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        const internalDate = parseInt(metaMessage.data.internalDate || '0');
        const snippet = metaMessage.data.snippet || '';
        const labelIds: string[] = metaMessage.data.labelIds || [];
        const threadId: string = metaMessage.data.threadId || message.id;

        // Skip emails at or before lastSyncTime
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const sourceURL = `https://mail.google.com/mail/u/0/#sent/${message.id}`;

        const metadata: GmailScheduledEmailMetadata = {
          id: message.id,
          threadId,
          subject,
          from: emailAddress,
          to,
          date,
          internalDate,
          snippet,
          labelIds,
          sourceURL,
        };

        activities.push(createActivityMessage(metadata));
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
    // Check if we have a valid access token
    if (!config?.access_token) {
      return [];
    }

    // Get settings or initialize if not present
    let settings = (state || {}) as GmailSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Create Gmail client
    const gmailConfig: GmailConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: integrationDefinition.config.clientId || '',
      client_secret: integrationDefinition.config.clientSecret || '',
    };

    const gmail = await getGmailClient(gmailConfig);

    // Get user profile to get email address
    if (!settings.emailAddress) {
      try {
        const profile = await gmail.users.getProfile({ userId: 'me' });
        settings.emailAddress = profile.data.emailAddress as string;
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    }

    // Collect all messages
    const messages = [];

    // Process received emails
    const { activities: receivedActivities, lastEmailTime: receivedLastTime } =
      await processReceivedEmails(gmail, lastSyncTime, settings.emailAddress || 'user');
    messages.push(...receivedActivities);

    // Process sent emails
    const { activities: sentActivities, lastEmailTime: sentLastTime } = await processSentEmails(
      gmail,
      lastSyncTime,
      settings.emailAddress || 'user'
    );
    messages.push(...sentActivities);

    // Only save state if emails were processed
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
