import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

import { generatedTools, handleGeneratedTool } from './generated-tools';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

let graphClient: AxiosInstance;

async function loadCredentials(
  clientId: string,
  clientSecret: string,
  _redirectUri: string,
  config: Record<string, string>
) {
  let accessToken = config.access_token;

  // Try refreshing the token
  try {
    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: config.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/.default offline_access',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    accessToken = response.data.access_token;
  } catch {
    // Use existing token if refresh fails
  }

  graphClient = axios.create({
    baseURL: GRAPH_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Schema Definitions ───

const SearchEmailsSchema = z.object({
  query: z.string().describe('Search query for emails (uses Microsoft Search syntax)'),
  top: z.number().optional().default(25).describe('Number of results to return (max 50)'),
  folder: z
    .string()
    .optional()
    .describe('Folder to search in (e.g. inbox, sentitems, drafts). Defaults to all folders'),
});

const ReadEmailSchema = z.object({
  messageId: z.string().describe('The ID of the email message to read'),
});

const SendEmailSchema = z.object({
  to: z.array(z.string()).describe('Array of recipient email addresses'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body content (supports HTML)'),
  cc: z.array(z.string()).optional().describe('Array of CC email addresses'),
  bcc: z.array(z.string()).optional().describe('Array of BCC email addresses'),
  isHtml: z.boolean().optional().default(true).describe('Whether the body content is HTML'),
});

const ReplyToEmailSchema = z.object({
  messageId: z.string().describe('The ID of the email to reply to'),
  body: z.string().describe('Reply body content (supports HTML)'),
  replyAll: z.boolean().optional().default(false).describe('Whether to reply all'),
});

const ForwardEmailSchema = z.object({
  messageId: z.string().describe('The ID of the email to forward'),
  to: z.array(z.string()).describe('Array of recipient email addresses'),
  comment: z.string().optional().describe('Optional comment to include with forwarded email'),
});

const CreateDraftSchema = z.object({
  to: z.array(z.string()).describe('Array of recipient email addresses'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body content (supports HTML)'),
  cc: z.array(z.string()).optional().describe('Array of CC email addresses'),
  isHtml: z.boolean().optional().default(true).describe('Whether the body content is HTML'),
});

const MoveEmailSchema = z.object({
  messageId: z.string().describe('The ID of the email to move'),
  destinationFolder: z
    .string()
    .describe(
      'Destination folder ID or well-known name (inbox, drafts, sentitems, deleteditems, archive, junkemail)'
    ),
});

const ListFoldersSchema = z.object({
  top: z.number().optional().default(25).describe('Number of folders to return'),
});

const ListEventsSchema = z.object({
  startDateTime: z.string().describe('Start date/time in ISO 8601 format'),
  endDateTime: z.string().describe('End date/time in ISO 8601 format'),
  top: z.number().optional().default(25).describe('Number of events to return'),
});

const CreateEventSchema = z.object({
  subject: z.string().describe('Event subject/title'),
  start: z.string().describe('Start date/time in ISO 8601 format'),
  end: z.string().describe('End date/time in ISO 8601 format'),
  timeZone: z.string().optional().default('UTC').describe('Time zone for the event'),
  location: z.string().optional().describe('Event location'),
  body: z.string().optional().describe('Event description/body (supports HTML)'),
  attendees: z.array(z.string()).optional().describe('Array of attendee email addresses'),
  isOnlineMeeting: z.boolean().optional().default(false).describe('Create as online meeting'),
});

const UpdateEventSchema = z.object({
  eventId: z.string().describe('The ID of the event to update'),
  subject: z.string().optional().describe('New event subject/title'),
  start: z.string().optional().describe('New start date/time in ISO 8601 format'),
  end: z.string().optional().describe('New end date/time in ISO 8601 format'),
  timeZone: z.string().optional().describe('Time zone for the event'),
  location: z.string().optional().describe('New event location'),
  body: z.string().optional().describe('New event description/body'),
});

const DeleteEventSchema = z.object({
  eventId: z.string().describe('The ID of the event to delete'),
});

const GetEventSchema = z.object({
  eventId: z.string().describe('The ID of the event to get'),
});

const RespondToEventSchema = z.object({
  eventId: z.string().describe('The ID of the event to respond to'),
  response: z
    .enum(['accept', 'tentativelyAccept', 'decline'])
    .describe('Response to the event invitation'),
  comment: z.string().optional().describe('Optional comment with the response'),
});

const ListContactsSchema = z.object({
  top: z.number().optional().default(25).describe('Number of contacts to return'),
  search: z.string().optional().describe('Search query to filter contacts'),
});

const CreateContactSchema = z.object({
  givenName: z.string().describe('First name'),
  surname: z.string().optional().describe('Last name'),
  emailAddresses: z
    .array(z.object({ address: z.string(), name: z.string().optional() }))
    .optional()
    .describe('Email addresses'),
  businessPhones: z.array(z.string()).optional().describe('Business phone numbers'),
  mobilePhone: z.string().optional().describe('Mobile phone number'),
  companyName: z.string().optional().describe('Company name'),
  jobTitle: z.string().optional().describe('Job title'),
});

const DeleteContactSchema = z.object({
  contactId: z.string().describe('The ID of the contact to delete'),
});

const DeleteEmailSchema = z.object({
  messageId: z.string().describe('The ID of the email to delete'),
});

// ─── Tool Definitions ───

export async function getTools() {
  return [
    // Mail tools
    {
      name: 'outlook_search_emails',
      description:
        'Search for emails in Outlook using Microsoft Search syntax. Supports queries like "from:user@example.com", "subject:meeting", or free-text search.',
      inputSchema: zodToJsonSchema(SearchEmailsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_read_email',
      description: 'Read the full content of a specific email by its ID.',
      inputSchema: zodToJsonSchema(ReadEmailSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_send_email',
      description: 'Send a new email from the connected Outlook account.',
      inputSchema: zodToJsonSchema(SendEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_reply_to_email',
      description: 'Reply to an existing email. Supports reply and reply-all.',
      inputSchema: zodToJsonSchema(ReplyToEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_forward_email',
      description: 'Forward an existing email to new recipients.',
      inputSchema: zodToJsonSchema(ForwardEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_create_draft',
      description: 'Create a draft email in the Drafts folder.',
      inputSchema: zodToJsonSchema(CreateDraftSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_move_email',
      description:
        'Move an email to a different folder (inbox, drafts, sentitems, deleteditems, archive, junkemail).',
      inputSchema: zodToJsonSchema(MoveEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_delete_email',
      description: 'Delete an email (moves to deleted items).',
      inputSchema: zodToJsonSchema(DeleteEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'outlook_list_folders',
      description: 'List all mail folders in the Outlook account.',
      inputSchema: zodToJsonSchema(ListFoldersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // Calendar tools
    {
      name: 'outlook_list_events',
      description:
        'List calendar events within a date range. Returns events from the primary calendar.',
      inputSchema: zodToJsonSchema(ListEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_get_event',
      description: 'Get full details of a specific calendar event.',
      inputSchema: zodToJsonSchema(GetEventSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_create_event',
      description:
        'Create a new calendar event. Supports setting attendees, location, online meetings, and more.',
      inputSchema: zodToJsonSchema(CreateEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_update_event',
      description: 'Update an existing calendar event.',
      inputSchema: zodToJsonSchema(UpdateEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_delete_event',
      description: 'Delete a calendar event.',
      inputSchema: zodToJsonSchema(DeleteEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: 'outlook_respond_to_event',
      description: 'Accept, tentatively accept, or decline a calendar event invitation.',
      inputSchema: zodToJsonSchema(RespondToEventSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },

    // Contacts tools
    {
      name: 'outlook_list_contacts',
      description: 'List contacts from the Outlook address book. Supports search filtering.',
      inputSchema: zodToJsonSchema(ListContactsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'outlook_create_contact',
      description: 'Create a new contact in the Outlook address book.',
      inputSchema: zodToJsonSchema(CreateContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'outlook_delete_contact',
      description: 'Delete a contact from the Outlook address book.',
      inputSchema: zodToJsonSchema(DeleteContactSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    ...generatedTools,
  ];
}

// ─── Tool Implementations ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatResponse(data: any): string {
  return JSON.stringify(data, null, 2);
}

function toRecipients(emails: string[]) {
  return emails.map(email => ({
    emailAddress: { address: email },
  }));
}

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  credentials: Record<string, string>
) {
  await loadCredentials(clientId, clientSecret, redirectUri, credentials);

  try {
    switch (name) {
      // ─── Mail ───

      case 'outlook_search_emails': {
        const { query, top, folder } = SearchEmailsSchema.parse(args);
        const basePath = folder ? `/me/mailFolders/${folder}/messages` : '/me/messages';
        const response = await graphClient.get(basePath, {
          params: {
            $search: `"${query}"`,
            $top: top,
            $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,importance,webLink',
            $orderby: 'receivedDateTime desc',
          },
        });

        const emails = (response.data.value || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (msg: any) => ({
            id: msg.id,
            subject: msg.subject,
            from: msg.from?.emailAddress?.address,
            fromName: msg.from?.emailAddress?.name,
            receivedDateTime: msg.receivedDateTime,
            preview: msg.bodyPreview,
            isRead: msg.isRead,
            importance: msg.importance,
            webLink: msg.webLink,
          })
        );

        return {
          content: [{ type: 'text', text: formatResponse(emails) }],
        };
      }

      case 'outlook_read_email': {
        const { messageId } = ReadEmailSchema.parse(args);
        const response = await graphClient.get(`/me/messages/${messageId}`, {
          params: {
            $select:
              'id,subject,from,toRecipients,ccRecipients,body,receivedDateTime,hasAttachments,importance,webLink',
          },
        });

        const msg = response.data;
        return {
          content: [
            {
              type: 'text',
              text: formatResponse({
                id: msg.id,
                subject: msg.subject,
                from: msg.from?.emailAddress,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                to: msg.toRecipients?.map((r: any) => r.emailAddress),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cc: msg.ccRecipients?.map((r: any) => r.emailAddress),
                body: msg.body?.content,
                bodyType: msg.body?.contentType,
                receivedDateTime: msg.receivedDateTime,
                hasAttachments: msg.hasAttachments,
                importance: msg.importance,
                webLink: msg.webLink,
              }),
            },
          ],
        };
      }

      case 'outlook_send_email': {
        const { to, subject, body, cc, bcc, isHtml } = SendEmailSchema.parse(args);
        await graphClient.post('/me/sendMail', {
          message: {
            subject,
            body: { contentType: isHtml ? 'html' : 'text', content: body },
            toRecipients: toRecipients(to),
            ccRecipients: cc ? toRecipients(cc) : undefined,
            bccRecipients: bcc ? toRecipients(bcc) : undefined,
          },
        });

        return {
          content: [{ type: 'text', text: `Email sent successfully to ${to.join(', ')}` }],
        };
      }

      case 'outlook_reply_to_email': {
        const { messageId, body, replyAll } = ReplyToEmailSchema.parse(args);
        const endpoint = replyAll
          ? `/me/messages/${messageId}/replyAll`
          : `/me/messages/${messageId}/reply`;

        await graphClient.post(endpoint, { comment: body });

        return {
          content: [
            { type: 'text', text: `Reply sent successfully${replyAll ? ' (reply all)' : ''}` },
          ],
        };
      }

      case 'outlook_forward_email': {
        const { messageId, to, comment } = ForwardEmailSchema.parse(args);
        await graphClient.post(`/me/messages/${messageId}/forward`, {
          comment: comment || '',
          toRecipients: toRecipients(to),
        });

        return {
          content: [
            { type: 'text', text: `Email forwarded successfully to ${to.join(', ')}` },
          ],
        };
      }

      case 'outlook_create_draft': {
        const { to, subject, body, cc, isHtml } = CreateDraftSchema.parse(args);
        const response = await graphClient.post('/me/messages', {
          subject,
          body: { contentType: isHtml ? 'html' : 'text', content: body },
          toRecipients: toRecipients(to),
          ccRecipients: cc ? toRecipients(cc) : undefined,
        });

        return {
          content: [
            { type: 'text', text: `Draft created successfully. ID: ${response.data.id}` },
          ],
        };
      }

      case 'outlook_move_email': {
        const { messageId, destinationFolder } = MoveEmailSchema.parse(args);
        const response = await graphClient.post(`/me/messages/${messageId}/move`, {
          destinationId: destinationFolder,
        });

        return {
          content: [
            { type: 'text', text: `Email moved successfully. New ID: ${response.data.id}` },
          ],
        };
      }

      case 'outlook_delete_email': {
        const { messageId } = DeleteEmailSchema.parse(args);
        await graphClient.delete(`/me/messages/${messageId}`);

        return {
          content: [{ type: 'text', text: 'Email deleted successfully' }],
        };
      }

      case 'outlook_list_folders': {
        const { top } = ListFoldersSchema.parse(args);
        const response = await graphClient.get('/me/mailFolders', {
          params: {
            $top: top,
            $select: 'id,displayName,totalItemCount,unreadItemCount',
          },
        });

        const folders = (response.data.value || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (f: any) => ({
            id: f.id,
            name: f.displayName,
            totalItems: f.totalItemCount,
            unreadItems: f.unreadItemCount,
          })
        );

        return {
          content: [{ type: 'text', text: formatResponse(folders) }],
        };
      }

      // ─── Calendar ───

      case 'outlook_list_events': {
        const { startDateTime, endDateTime, top } = ListEventsSchema.parse(args);
        const response = await graphClient.get('/me/calendarView', {
          params: {
            startDateTime,
            endDateTime,
            $top: top,
            $select:
              'id,subject,start,end,location,organizer,attendees,isAllDay,webLink,bodyPreview',
            $orderby: 'start/dateTime asc',
          },
        });

        const events = (response.data.value || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => ({
            id: e.id,
            subject: e.subject,
            start: e.start,
            end: e.end,
            location: e.location?.displayName,
            organizer: e.organizer?.emailAddress,
            attendeeCount: e.attendees?.length || 0,
            isAllDay: e.isAllDay,
            preview: e.bodyPreview,
            webLink: e.webLink,
          })
        );

        return {
          content: [{ type: 'text', text: formatResponse(events) }],
        };
      }

      case 'outlook_get_event': {
        const { eventId } = GetEventSchema.parse(args);
        const response = await graphClient.get(`/me/events/${eventId}`, {
          params: {
            $select:
              'id,subject,start,end,location,organizer,attendees,body,isAllDay,webLink,recurrence,onlineMeeting',
          },
        });

        const e = response.data;
        return {
          content: [
            {
              type: 'text',
              text: formatResponse({
                id: e.id,
                subject: e.subject,
                start: e.start,
                end: e.end,
                location: e.location?.displayName,
                organizer: e.organizer?.emailAddress,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                attendees: e.attendees?.map((a: any) => ({
                  email: a.emailAddress,
                  status: a.status?.response,
                })),
                body: e.body?.content,
                isAllDay: e.isAllDay,
                recurrence: e.recurrence,
                onlineMeetingUrl: e.onlineMeeting?.joinUrl,
                webLink: e.webLink,
              }),
            },
          ],
        };
      }

      case 'outlook_create_event': {
        const { subject, start, end, timeZone, location, body, attendees, isOnlineMeeting } =
          CreateEventSchema.parse(args);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventPayload: any = {
          subject,
          start: { dateTime: start, timeZone },
          end: { dateTime: end, timeZone },
          isOnlineMeeting,
        };

        if (location) eventPayload.location = { displayName: location };
        if (body) eventPayload.body = { contentType: 'html', content: body };
        if (attendees) {
          eventPayload.attendees = attendees.map((email: string) => ({
            emailAddress: { address: email },
            type: 'required',
          }));
        }

        const response = await graphClient.post('/me/events', eventPayload);

        return {
          content: [
            {
              type: 'text',
              text: `Event created: "${subject}" (ID: ${response.data.id})${response.data.webLink ? `\nLink: ${response.data.webLink}` : ''}`,
            },
          ],
        };
      }

      case 'outlook_update_event': {
        const { eventId, subject, start, end, timeZone, location, body } =
          UpdateEventSchema.parse(args);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {};
        if (subject) updatePayload.subject = subject;
        if (start) updatePayload.start = { dateTime: start, timeZone: timeZone || 'UTC' };
        if (end) updatePayload.end = { dateTime: end, timeZone: timeZone || 'UTC' };
        if (location) updatePayload.location = { displayName: location };
        if (body) updatePayload.body = { contentType: 'html', content: body };

        await graphClient.patch(`/me/events/${eventId}`, updatePayload);

        return {
          content: [{ type: 'text', text: `Event ${eventId} updated successfully` }],
        };
      }

      case 'outlook_delete_event': {
        const { eventId } = DeleteEventSchema.parse(args);
        await graphClient.delete(`/me/events/${eventId}`);

        return {
          content: [{ type: 'text', text: `Event ${eventId} deleted successfully` }],
        };
      }

      case 'outlook_respond_to_event': {
        const { eventId, response, comment } = RespondToEventSchema.parse(args);
        await graphClient.post(`/me/events/${eventId}/${response}`, {
          comment: comment || '',
          sendResponse: true,
        });

        return {
          content: [
            { type: 'text', text: `Event ${eventId}: responded with "${response}"` },
          ],
        };
      }

      // ─── Contacts ───

      case 'outlook_list_contacts': {
        const { top, search } = ListContactsSchema.parse(args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = {
          $top: top,
          $select:
            'id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle',
        };
        if (search) params.$search = `"${search}"`;

        const response = await graphClient.get('/me/contacts', { params });

        const contacts = (response.data.value || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c: any) => ({
            id: c.id,
            displayName: c.displayName,
            givenName: c.givenName,
            surname: c.surname,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emails: c.emailAddresses?.map((e: any) => e.address),
            businessPhones: c.businessPhones,
            mobilePhone: c.mobilePhone,
            company: c.companyName,
            jobTitle: c.jobTitle,
          })
        );

        return {
          content: [{ type: 'text', text: formatResponse(contacts) }],
        };
      }

      case 'outlook_create_contact': {
        const validated = CreateContactSchema.parse(args);
        const response = await graphClient.post('/me/contacts', validated);

        return {
          content: [
            {
              type: 'text',
              text: `Contact created: ${response.data.displayName} (ID: ${response.data.id})`,
            },
          ],
        };
      }

      case 'outlook_delete_contact': {
        const { contactId } = DeleteContactSchema.parse(args);
        await graphClient.delete(`/me/contacts/${contactId}`);

        return {
          content: [{ type: 'text', text: `Contact ${contactId} deleted successfully` }],
        };
      }

      default: {
        return await handleGeneratedTool(name, args, graphClient);
      }
    }
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    const message = err.response?.data?.error?.message || err.message || 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
    };
  }
}
