import type { gmail_v1 } from 'googleapis';
import { getGmailClient, parseEmailContent, formatEmailSender, GmailConfig } from './utils';
import TurndownService from 'turndown';

interface GmailSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  emailAddress?: string;
}

interface GmailSyncWindow {
  lastSyncMs: number;
  syncStartedMs: number;
  searchBounds: string;
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
 * Trim cleaned email body to a short single-line preview suitable for the
 * activity feed. Full body is retrievable via the read_email MCP tool.
 */
function makeSnippet(content: string, max = 200): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

async function listScheduledMessageIds(gmail: gmail_v1.Gmail, q: string) {
  const ids = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 50,
      pageToken,
    });
    for (const message of data.messages ?? []) {
      if (message.id) ids.add(message.id);
    }

    pageToken = data.nextPageToken ?? undefined;
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        throw new Error('Gmail returned a repeated message page token');
      }
      seenPageTokens.add(pageToken);
    }
  } while (pageToken);

  return ids;
}

/**
 * Fetch and process received emails
 */
async function processReceivedEmails(
  gmail: any,
  window: GmailSyncWindow
): Promise<{ activities: any[]; lastEmailTime: number }> {
  const activities = [];
  let lastEmailTime = 0;

  const messageIds = await listScheduledMessageIds(
    gmail,
    `in:inbox is:important ${window.searchBounds}`
  );

  for (const messageId of messageIds) {
    try {
      // Get full message details
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const headers = fullMessage.data.payload.headers;
      const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';

      const internalDate = parseInt(fullMessage.data.internalDate || '0');

      if (internalDate <= window.lastSyncMs || internalDate >= window.syncStartedMs) {
        continue;
      }

      if (internalDate > lastEmailTime) {
        lastEmailTime = internalDate;
      }

      const sender = formatEmailSender(from);
      const threadId = fullMessage.data.threadId || '';
      const { textContent, htmlContent } = parseEmailContent(fullMessage.data.payload);

      const cleanedContent = cleanEmailContent(htmlContent, textContent);

      if (!cleanedContent || cleanedContent.length < 10) {
        continue;
      }

      const sourceURL = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
      const snippet = makeSnippet(cleanedContent);

      const text = `Received email from ${sender} (from: ${from}, subject: "${subject}", message_id: ${messageId}, thread_id: ${threadId}) at ${date}. Snippet: "${snippet}"`;

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

  return { activities, lastEmailTime };
}

/**
 * Fetch and process sent emails
 */
async function processSentEmails(
  gmail: any,
  window: GmailSyncWindow,
  emailAddress: string
): Promise<{ activities: any[]; lastEmailTime: number }> {
  const activities = [];
  let lastEmailTime = 0;

  const messageIds = await listScheduledMessageIds(
    gmail,
    `in:sent ${window.searchBounds}`
  );

  for (const messageId of messageIds) {
    try {
      // Get full message details
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const headers = fullMessage.data.payload.headers;
      const to = headers.find((h: any) => h.name === 'To')?.value || 'Unknown';
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';

      const internalDate = parseInt(fullMessage.data.internalDate || '0');

      if (internalDate <= window.lastSyncMs || internalDate >= window.syncStartedMs) {
        continue;
      }

      if (internalDate > lastEmailTime) {
        lastEmailTime = internalDate;
      }

      const threadId = fullMessage.data.threadId || messageId;
      const { textContent, htmlContent } = parseEmailContent(fullMessage.data.payload);

      const cleanedContent = cleanEmailContent(htmlContent, textContent);

      if (!cleanedContent || cleanedContent.length < 10) {
        continue;
      }

      const sourceURL = `https://mail.google.com/mail/u/0/#sent/${messageId}`;
      const snippet = makeSnippet(cleanedContent);

      const text = `Sent email to ${to} (from: ${emailAddress}, subject: "${subject}", message_id: ${messageId}, thread_id: ${threadId}) at ${date}. Snippet: "${snippet}"`;

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

    // Use the same upper bound for both searches. Gmail queries use seconds,
    // so expand the search window and enforce its millisecond bounds on each message.
    const lastSyncMs = new Date(lastSyncTime).getTime();
    const syncStartedMs = Date.now();
    const after = Math.floor(lastSyncMs / 1000) - 1;
    const before = Math.ceil(syncStartedMs / 1000);
    const window: GmailSyncWindow = {
      lastSyncMs,
      syncStartedMs,
      searchBounds: `after:${after} before:${before}`,
    };

    // Collect all messages
    const messages = [];

    // Process received emails
    const { activities: receivedActivities, lastEmailTime: receivedLastTime } =
      await processReceivedEmails(gmail, window);
    messages.push(...receivedActivities);

    // Process sent emails
    const { activities: sentActivities, lastEmailTime: sentLastTime } = await processSentEmails(
      gmail,
      window,
      settings.emailAddress || 'user'
    );
    messages.push(...sentActivities);

    // Only save state if emails were processed
    const latestEmailTime = Math.max(receivedLastTime, sentLastTime);
    if (latestEmailTime > 0) {
      // Never skip ahead of messages actually observed by this sync.
      const newSyncTime = new Date(latestEmailTime).toISOString();
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
