import { google, calendar_v3 } from 'googleapis';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OAuth2Client } from 'google-auth-library';
import { generatedTools, handleGeneratedTool } from './generated-tools';

// OAuth2 configuration
let oauth2Client: OAuth2Client;
let calendar: calendar_v3.Calendar;

async function loadCredentials(
  client_id: string,
  client_secret: string,
  callback: string,
  config: Record<string, string>
) {
  try {
    oauth2Client = new OAuth2Client(client_id, client_secret, callback);

    const credentials = {
      refresh_token: config.refresh_token,
      expiry_date:
        typeof config.expires_at === 'string' ? parseInt(config.expires_at) : config.expires_at,
      expires_in: config.expires_in,
      expires_at: config.expires_at,
      access_token: config.access_token,
      token_type: config.token_type,
      id_token: config.id_token,
      scope: config.scope,
    };

    oauth2Client.setCredentials(credentials);
    oauth2Client.refreshAccessToken();
  } catch (error) {
    console.error('Error loading credentials:', error);
    process.exit(1);
  }
}

// Custom tool schemas for common operations
const CreateEventSchema = z.object({
  calendarId: z
    .string()
    .optional()
    .default('primary')
    .describe('Calendar ID (default: primary calendar)'),
  summary: z.string().describe('Event title'),
  description: z.string().optional().describe('Event description'),
  location: z.string().optional().describe('Event location'),
  startDateTime: z
    .string()
    .describe('Start date/time in ISO 8601 format (e.g., 2024-01-01T10:00:00)'),
  endDateTime: z.string().describe('End date/time in ISO 8601 format'),
  timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York")'),
  attendees: z
    .array(z.object({ email: z.string() }))
    .optional()
    .describe('List of attendee emails'),
  reminders: z
    .object({
      useDefault: z.boolean().optional(),
      overrides: z
        .array(
          z.object({
            method: z.enum(['email', 'popup']),
            minutes: z.number(),
          })
        )
        .optional(),
    })
    .optional()
    .describe('Event reminders'),
  addGoogleMeet: z
    .boolean()
    .optional()
    .default(false)
    .describe('Automatically add a Google Meet video conference link to the event'),
});

const GetEventSchema = z.object({
  calendarId: z.string().optional().default('primary').describe('Calendar ID'),
  eventId: z.string().describe('Event ID'),
});

const ListEventsSchema = z.object({
  calendarId: z.string().optional().default('primary').describe('Calendar ID'),
  timeMin: z.string().optional().describe('Lower bound for event start time (ISO 8601)'),
  timeMax: z.string().optional().describe('Upper bound for event start time (ISO 8601)'),
  maxResults: z.number().optional().default(10).describe('Maximum number of events'),
  q: z.string().optional().describe('Free text search query'),
  orderBy: z.enum(['startTime', 'updated']).optional().describe('Order results by'),
  singleEvents: z
    .boolean()
    .optional()
    .default(true)
    .describe('Expand recurring events into instances'),
});

const UpdateEventSchema = z.object({
  calendarId: z.string().optional().default('primary').describe('Calendar ID'),
  eventId: z.string().describe('Event ID'),
  summary: z.string().optional().describe('New event title'),
  description: z.string().optional().describe('New description'),
  location: z.string().optional().describe('New location'),
  startDateTime: z.string().optional().describe('New start date/time (ISO 8601)'),
  endDateTime: z.string().optional().describe('New end date/time (ISO 8601)'),
  timeZone: z.string().optional().describe('Time zone'),
  attendees: z
    .array(z.object({ email: z.string() }))
    .optional()
    .describe('List of attendee emails to add/update'),
});

const DeleteEventSchema = z.object({
  calendarId: z.string().optional().default('primary').describe('Calendar ID'),
  eventId: z.string().describe('Event ID'),
  sendUpdates: z
    .enum(['all', 'externalOnly', 'none'])
    .optional()
    .default('none')
    .describe('Whether to send notifications'),
});

const ListCalendarsSchema = z.object({
  maxResults: z.number().optional().default(100).describe('Maximum number of calendars'),
  showHidden: z.boolean().optional().default(false).describe('Show hidden calendars'),
});

const QuickAddEventSchema = z.object({
  calendarId: z.string().optional().default('primary').describe('Calendar ID'),
  text: z
    .string()
    .describe(
      'Natural language event description (e.g., "Dinner with John tomorrow at 7pm at Olive Garden")'
    ),
});

const GetFreeBusySchema = z.object({
  timeMin: z.string().describe('Start of the interval (ISO 8601)'),
  timeMax: z.string().describe('End of the interval (ISO 8601)'),
  calendarIds: z
    .array(z.string())
    .optional()
    .default(['primary'])
    .describe('Calendar IDs to check'),
  timeZone: z.string().optional().describe('Time zone for the response'),
});

export async function getTools() {
  return [
    // Custom high-level tools
    {
      name: 'create_event',
      description: 'Creates a new calendar event',
      inputSchema: zodToJsonSchema(CreateEventSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    {
      name: 'get_event',
      description: 'Gets details of a specific calendar event',
      inputSchema: zodToJsonSchema(GetEventSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    {
      name: 'list_events',
      description: 'Lists calendar events within a time range',
      inputSchema: zodToJsonSchema(ListEventsSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    {
      name: 'update_event',
      description: 'Updates an existing calendar event',
      inputSchema: zodToJsonSchema(UpdateEventSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    {
      name: 'delete_event',
      description: 'Deletes a calendar event',
      inputSchema: zodToJsonSchema(DeleteEventSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    {
      name: 'list_calendars',
      description: 'Lists all calendars accessible to the user',
      inputSchema: zodToJsonSchema(ListCalendarsSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    {
      name: 'quick_add_event',
      description: 'Creates an event using natural language',
      inputSchema: zodToJsonSchema(QuickAddEventSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    {
      name: 'get_freebusy',
      description: 'Gets free/busy information for calendars',
      inputSchema: zodToJsonSchema(GetFreeBusySchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    // Auto-generated tools from Discovery Document
    ...generatedTools,
  ];
}

/**
 * Call a specific tool without starting the MCP server
 */
export async function callTool(
  name: string,
  args: Record<string, any>,
  client_id: string,
  client_secret: string,
  callback: string,
  credentials: Record<string, string>
) {
  await loadCredentials(client_id, client_secret, callback, credentials);
  // Initialize Calendar API
  calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    switch (name) {
      case 'create_event': {
        const validatedArgs = CreateEventSchema.parse(args);
        const event: calendar_v3.Schema$Event = {
          summary: validatedArgs.summary,
          description: validatedArgs.description,
          location: validatedArgs.location,
          start: {
            dateTime: validatedArgs.startDateTime,
            timeZone: validatedArgs.timeZone,
          },
          end: {
            dateTime: validatedArgs.endDateTime,
            timeZone: validatedArgs.timeZone,
          },
          attendees: validatedArgs.attendees,
          reminders: validatedArgs.reminders,
        };

        // Add Google Meet conference data if requested
        if (validatedArgs.addGoogleMeet) {
          event.conferenceData = {
            createRequest: {
              requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              conferenceSolutionKey: {
                type: 'hangoutsMeet',
              },
            },
          };
        }

        const response = await calendar.events.insert({
          calendarId: validatedArgs.calendarId,
          requestBody: event,
          conferenceDataVersion: validatedArgs.addGoogleMeet ? 1 : 0,
        });

        let resultText = `Event created successfully!\nEvent ID: ${response.data.id}\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime}\nEnd: ${response.data.end?.dateTime}\nLink: ${response.data.htmlLink}`;

        if (validatedArgs.addGoogleMeet && response.data.conferenceData?.entryPoints) {
          const meetLink = response.data.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')?.uri;
          if (meetLink) {
            resultText += `\nGoogle Meet: ${meetLink}`;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: resultText,
            },
          ],
        };
      }

      case 'get_event': {
        const validatedArgs = GetEventSchema.parse(args);
        const response = await calendar.events.get({
          calendarId: validatedArgs.calendarId,
          eventId: validatedArgs.eventId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Event: ${response.data.summary}\nID: ${response.data.id}\nDescription: ${response.data.description || 'N/A'}\nLocation: ${response.data.location || 'N/A'}\nStart: ${response.data.start?.dateTime || response.data.start?.date}\nEnd: ${response.data.end?.dateTime || response.data.end?.date}\nStatus: ${response.data.status}\nLink: ${response.data.htmlLink}`,
            },
          ],
        };
      }

      case 'list_events': {
        const validatedArgs = ListEventsSchema.parse(args);
        const response = await calendar.events.list({
          calendarId: validatedArgs.calendarId,
          timeMin: validatedArgs.timeMin,
          timeMax: validatedArgs.timeMax,
          maxResults: validatedArgs.maxResults,
          singleEvents: validatedArgs.singleEvents,
          orderBy: validatedArgs.orderBy,
          q: validatedArgs.q,
        });

        const events = response.data.items || [];
        if (events.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No events found in the specified time range.',
              },
            ],
          };
        }

        const eventList = events
          .map(
            event =>
              `- ${event.summary} (${event.start?.dateTime || event.start?.date})\n  ID: ${event.id}\n  Location: ${event.location || 'N/A'}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${events.length} events:\n\n${eventList}`,
            },
          ],
        };
      }

      case 'update_event': {
        const validatedArgs = UpdateEventSchema.parse(args);

        // First get the existing event
        const existingEvent = await calendar.events.get({
          calendarId: validatedArgs.calendarId,
          eventId: validatedArgs.eventId,
        });

        // Merge updates with existing event
        const updatedEvent: calendar_v3.Schema$Event = {
          ...existingEvent.data,
          summary: validatedArgs.summary || existingEvent.data.summary,
          description: validatedArgs.description || existingEvent.data.description,
          location: validatedArgs.location || existingEvent.data.location,
        };

        if (validatedArgs.startDateTime) {
          updatedEvent.start = {
            dateTime: validatedArgs.startDateTime,
            timeZone: validatedArgs.timeZone || existingEvent.data.start?.timeZone,
          };
        }

        if (validatedArgs.endDateTime) {
          updatedEvent.end = {
            dateTime: validatedArgs.endDateTime,
            timeZone: validatedArgs.timeZone || existingEvent.data.end?.timeZone,
          };
        }

        if (validatedArgs.attendees) {
          updatedEvent.attendees = validatedArgs.attendees;
        }

        const response = await calendar.events.update({
          calendarId: validatedArgs.calendarId,
          eventId: validatedArgs.eventId,
          requestBody: updatedEvent,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Event updated successfully!\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime}\nEnd: ${response.data.end?.dateTime}${validatedArgs.attendees ? `\nAttendees: ${validatedArgs.attendees.map(a => a.email).join(', ')}` : ''}`,
            },
          ],
        };
      }

      case 'delete_event': {
        const validatedArgs = DeleteEventSchema.parse(args);
        await calendar.events.delete({
          calendarId: validatedArgs.calendarId,
          eventId: validatedArgs.eventId,
          sendUpdates: validatedArgs.sendUpdates,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Event ${validatedArgs.eventId} deleted successfully`,
            },
          ],
        };
      }

      case 'list_calendars': {
        const validatedArgs = ListCalendarsSchema.parse(args);
        const response = await calendar.calendarList.list({
          maxResults: validatedArgs.maxResults,
          showHidden: validatedArgs.showHidden,
        });

        const calendars = response.data.items || [];
        if (calendars.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No calendars found.',
              },
            ],
          };
        }

        const calendarList = calendars
          .map(
            cal =>
              `- ${cal.summary}\n  ID: ${cal.id}\n  Primary: ${cal.primary || false}\n  Access Role: ${cal.accessRole}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${calendars.length} calendars:\n\n${calendarList}`,
            },
          ],
        };
      }

      case 'quick_add_event': {
        const validatedArgs = QuickAddEventSchema.parse(args);
        const response = await calendar.events.quickAdd({
          calendarId: validatedArgs.calendarId,
          text: validatedArgs.text,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Event created from quick add!\nEvent ID: ${response.data.id}\nTitle: ${response.data.summary}\nStart: ${response.data.start?.dateTime || response.data.start?.date}\nEnd: ${response.data.end?.dateTime || response.data.end?.date}\nLink: ${response.data.htmlLink}`,
            },
          ],
        };
      }

      case 'get_freebusy': {
        const validatedArgs = GetFreeBusySchema.parse(args);
        const response = await calendar.freebusy.query({
          requestBody: {
            timeMin: validatedArgs.timeMin,
            timeMax: validatedArgs.timeMax,
            timeZone: validatedArgs.timeZone,
            items: validatedArgs.calendarIds.map(id => ({ id })),
          },
        });

        let result = `Free/Busy information:\n\n`;
        for (const [calendarId, calendar] of Object.entries(response.data.calendars || {})) {
          const cal = calendar as calendar_v3.Schema$FreeBusyCalendar;
          result += `Calendar: ${calendarId}\n`;
          if (cal.busy && cal.busy.length > 0) {
            result += `Busy times:\n`;
            cal.busy.forEach(period => {
              result += `  - ${period.start} to ${period.end}\n`;
            });
          } else {
            result += `  No busy times in this period\n`;
          }
          result += '\n';
        }

        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      default:
        // Try to handle with auto-generated tools
        return await handleGeneratedTool(name, args, calendar);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
}
