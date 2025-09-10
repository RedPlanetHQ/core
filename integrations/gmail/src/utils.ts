import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface ActivityCreate {
  url: string;
  text: string;
  sourceId: string;
  sourceURL: string;
  integrationAccountId: string;
}

export interface GmailConfig {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
}

export interface EmailContent {
  textContent: string;
  htmlContent: string;
}

/**
 * Create an authenticated Gmail client
 */
export async function getGmailClient(config: GmailConfig) {
  const oAuth2Client = new OAuth2Client(
    config.client_id,
    config.client_secret,
    'urn:ietf:wg:oauth:2.0:oob' // Redirect URI for installed applications
  );

  oAuth2Client.setCredentials({
    access_token: config.access_token,
    refresh_token: config.refresh_token,
  });

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

/**
 * Parse email content from Gmail message payload
 */
export function parseEmailContent(payload: any): EmailContent {
  let textContent = '';
  let htmlContent = '';

  if (payload.parts) {
    // Multi-part email
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        textContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        htmlContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
  } else if (payload.body?.data) {
    // Single-part email
    if (payload.mimeType === 'text/plain') {
      textContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.mimeType === 'text/html') {
      htmlContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
  }

  // If we only have HTML, try to extract text from it
  if (!textContent && htmlContent) {
    textContent = htmlContent.replace(/<[^>]*>/g, '').trim();
  }

  return { textContent, htmlContent };
}

/**
 * Format email sender for display
 */
export function formatEmailSender(from: string): string {
  // Extract name and email from "Name <email@domain.com>" format
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return match[1].trim();
  }
  return from;
}

/**
 * Get Gmail user profile information
 */
export async function getUserProfile(config: GmailConfig) {
  const gmail = await getGmailClient(config);
  const response = await gmail.users.getProfile({ userId: 'me' });
  return response.data;
}

/**
 * Search for emails with a query
 */
export async function searchEmails(config: GmailConfig, query: string, maxResults: number = 10) {
  const gmail = await getGmailClient(config);
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });
  return response.data.messages || [];
}

/**
 * Send an email
 */
export async function sendEmail(config: GmailConfig, to: string, subject: string, body: string) {
  const gmail = await getGmailClient(config);
  
  // Create the email message
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    body
  ].join('\n');

  // Encode the message
  const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });

  return response.data;
} 