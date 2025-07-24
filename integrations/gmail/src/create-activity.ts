import axios from 'axios';
import { google } from 'googleapis';
import { getGmailClient, parseEmailContent, formatEmailSender } from './utils';

export const createActivityEvent = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBody: any,
  config: any,
) => {
  const { eventData } = eventBody;
  
  if (!config) {
    throw new Error('Integration configuration not found');
  }

  // Handle new email notifications
  if (eventData.event.type === 'email_received') {
    const event = eventData.event;
    
    try {
      const gmail = await getGmailClient(config);
      
      // Get the full email details
      const emailResponse = await gmail.users.messages.get({
        userId: 'me',
        id: event.messageId,
        format: 'full',
      });

      const email = emailResponse.data;
      const headers = email.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown Recipient';
      const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
      
      const { textContent, htmlContent } = parseEmailContent(email.payload);
      
      // Format the activity text
      const text = `New email from ${formatEmailSender(from)} - Subject: "${subject}"
To: ${to}
Date: ${date}
Content: ${textContent}`;

      // Create a permalink (Gmail web URL)
      const sourceURL = `https://mail.google.com/mail/u/0/#inbox/${event.messageId}`;

      const activity = {
        sourceURL,
        source: 'gmail',
        text,
        integrationAccountId: config.integrationAccountId,
      };

      await axios.post('/api/v1/activity', activity);
      
    } catch (error) {
      console.error('Error processing Gmail email:', error);
      throw error;
    }
  }

  // Handle email sent notifications
  if (eventData.event.type === 'email_sent') {
    const event = eventData.event;
    
    try {
      const gmail = await getGmailClient(config);
      
      // Get the sent email details
      const emailResponse = await gmail.users.messages.get({
        userId: 'me',
        id: event.messageId,
        format: 'full',
      });

      const email = emailResponse.data;
      const headers = email.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown Recipient';
      const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
      
      const { textContent } = parseEmailContent(email.payload);
      
      // Format the activity text
      const text = `Email sent to ${to} - Subject: "${subject}"
Date: ${date}
Content: ${textContent}`;

      // Create a permalink (Gmail web URL)
      const sourceURL = `https://mail.google.com/mail/u/0/#sent/${event.messageId}`;

      const activity = {
        sourceURL,
        source: 'gmail',
        text,
        integrationAccountId: config.integrationAccountId,
      };

      await axios.post('/api/v1/activity', activity);
      
    } catch (error) {
      console.error('Error processing Gmail sent email:', error);
      throw error;
    }
  }

  // Handle starred email notifications
  if (eventData.event.type === 'email_starred') {
    const event = eventData.event;
    
    try {
      const gmail = await getGmailClient(config);
      
      // Get the starred email details
      const emailResponse = await gmail.users.messages.get({
        userId: 'me',
        id: event.messageId,
        format: 'full',
      });

      const email = emailResponse.data;
      const headers = email.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
      const date = headers.find(h => h.name === 'Date')?.value || 'Unknown Date';
      
      const { textContent } = parseEmailContent(email.payload);
      
      // Format the activity text
      const text = `Email starred from ${formatEmailSender(from)} - Subject: "${subject}"
Date: ${date}
Content: ${textContent}`;

      // Create a permalink (Gmail web URL)
      const sourceURL = `https://mail.google.com/mail/u/0/#starred/${event.messageId}`;

      const activity = {
        sourceURL,
        source: 'gmail',
        text,
        integrationAccountId: config.integrationAccountId,
      };

      await axios.post('/api/v1/activity', activity);
      
    } catch (error) {
      console.error('Error processing Gmail starred email:', error);
      throw error;
    }
  }

  return { message: `Processed activity from Gmail` };
}; 