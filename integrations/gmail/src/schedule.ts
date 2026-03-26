import { getGmailClient, parseEmailContent, formatEmailSender, GmailConfig } from './utils';
import TurndownService from 'turndown';

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
 * Creates an activity message based on Gmail data
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
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Initialize Turndown service for HTML to Markdown conversion
 */
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

// Remove style, script, and other unwanted elements
turndownService.remove(['style', 'script', 'noscript', 'iframe', 'object', 'embed']);

/**
 * Clean and convert email content to markdown
 */
function cleanEmailContent(htmlContent: string, textContent: string): string {
  // If we have HTML content, convert it to markdown
  if (htmlContent) {
    const markdown = turndownService.turndown(htmlContent);
    return markdown
      .replace(/\n\n+/g, '\n\n') // Remove excessive line breaks
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  // Otherwise use text content and clean it
  return textContent.replace(/\r/g, '').replace(/\n\n+/g, '\n\n').replace(/\s+/g, ' ').trim();
}

/**
 * Convert ISO date to Gmail query format as Unix timestamp in seconds
 * Using timestamp is more precise than YYYY/MM/DD which truncates to day
 */
function toGmailTimestamp(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

/**
 * Fetch and process received emails
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
    // Query for important received emails after lastSyncTime
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox is:important after:${afterTimestamp}`,
      maxResults: 50,
    });

    const messages = response.data.messages || [];

    for (const message of messages) {
      try {
        // Get full message details
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });

        const headers = fullMessage.data.payload.headers;
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        const internalDate = parseInt(fullMessage.data.internalDate || '0');

        // Skip emails that are at or before lastSyncTime (Gmail after: is not precise at second level)
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const sender = formatEmailSender(from);
        const threadId = fullMessage.data.threadId || '';
        const { textContent, htmlContent } = parseEmailContent(fullMessage.data.payload);

        // Clean and convert email content to markdown
        const cleanedContent = cleanEmailContent(htmlContent, textContent);

        // Skip if no meaningful content
        if (!cleanedContent || cleanedContent.length < 10) {
          continue;
        }

        // Create Gmail web URL
        const sourceURL = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;

        // Format activity text with full email content as markdown
        const text = `## 📧 Email from ${sender}

**From:** ${from}
**Subject:** ${subject}
**Date:** ${date}
**Thread ID:** ${threadId}

${cleanedContent}`;

        activities.push(
          createActivityMessage({
            text,
            sourceURL,
          })
        );
      } catch (error) {
        // Silently ignore errors for individual messages
        console.error('Error processing received email:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching received emails:', error);
  }

  return { activities, lastEmailTime };
}

/**
 * Fetch and process sent emails
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
    // Query for sent emails after lastSyncTime
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${afterTimestamp}`,
      maxResults: 50,
    });

    const messages = response.data.messages || [];

    for (const message of messages) {
      try {
        // Get full message details
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });

        const headers = fullMessage.data.payload.headers;
        const to = headers.find((h: any) => h.name === 'To')?.value || 'Unknown';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';

        const internalDate = parseInt(fullMessage.data.internalDate || '0');

        // Skip emails that are at or before lastSyncTime
        const lastSyncMs = new Date(lastSyncTime).getTime();
        if (internalDate <= lastSyncMs) {
          continue;
        }

        if (internalDate > lastEmailTime) {
          lastEmailTime = internalDate;
        }

        const threadId = fullMessage.data.threadId || message.id;
        const { textContent, htmlContent } = parseEmailContent(fullMessage.data.payload);

        // Clean and convert email content to markdown
        const cleanedContent = cleanEmailContent(htmlContent, textContent);

        // Skip if no meaningful content
        if (!cleanedContent || cleanedContent.length < 10) {
          continue;
        }

        // Create Gmail web URL
        const sourceURL = `https://mail.google.com/mail/u/0/#sent/${message.id}`;

        // Format activity text with full email content as markdown
        const text = `## 📤 Sent to ${to}

**From:** ${emailAddress}
**To:** ${to}
**Subject:** ${subject}
**Date:** ${date}
**Thread ID:** ${threadId}

${cleanedContent}`;

        activities.push(
          createActivityMessage({
            text,
            sourceURL,
          })
        );
      } catch (error) {
        // Silently ignore errors for individual messages
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
