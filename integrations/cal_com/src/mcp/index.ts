import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import axios, { AxiosInstance } from 'axios';

// Cal.com API client
let calComClient: AxiosInstance;

async function initializeClient(config: Record<string, string>) {
  const baseURL = config.cal_api_url || 'https://api.cal.com/v2';

  calComClient = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
    },
  });
}

// Tool schemas
const GetAllSchedulesSchema = z.object({});

const CreateScheduleSchema = z.object({
  name: z.string().describe('Name of the new schedule'),
  timeZone: z.string().describe("Time zone ID (e.g., 'America/New_York')"),
  isDefault: z.boolean().describe('Whether this should be the default schedule'),
  availability: z
    .array(
      z.object({
        days: z.array(z.string()).describe("Capitalized day names (e.g., ['Monday','Tuesday'])"),
        startTime: z.string().describe("Start time in HH:mm format (e.g., '09:00')"),
        endTime: z.string().describe("End time in HH:mm format (e.g., '17:00')"),
      })
    )
    .optional()
    .describe('List of availability blocks'),
  overrides: z
    .array(
      z.object({
        date: z.string().describe("Date in YYYY-MM-DD format (e.g., '2023-12-31')"),
        startTime: z.string().describe("Start time in HH:mm format (e.g., '10:00')"),
        endTime: z.string().describe("End time in HH:mm format (e.g., '15:00')"),
      })
    )
    .optional()
    .describe('Date-specific overrides'),
});

const UpdateScheduleSchema = z.object({
  schedule_id: z.number().describe('ID of the schedule to update'),
  name: z.string().optional().describe('Updated schedule name'),
  timeZone: z.string().optional().describe("Updated time zone ID (e.g., 'America/New_York')"),
  isDefault: z.boolean().optional().describe('Whether to make this the default schedule'),
  availability: z
    .array(
      z.object({
        days: z.array(z.string()).describe("Capitalized day names (e.g., ['Monday','Tuesday'])"),
        startTime: z.string().describe("Start time in HH:mm format (e.g., '09:00')"),
        endTime: z.string().describe("End time in HH:mm format (e.g., '17:00')"),
      })
    )
    .optional()
    .describe('Updated availability blocks'),
  overrides: z
    .array(
      z.object({
        date: z.string().describe("Date in YYYY-MM-DD format (e.g., '2023-12-31')"),
        startTime: z.string().describe("Start time in HH:mm format (e.g., '10:00')"),
        endTime: z.string().describe("End time in HH:mm format (e.g., '15:00')"),
      })
    )
    .optional()
    .describe('Updated date overrides'),
});

const GetDefaultScheduleSchema = z.object({});

const GetScheduleSchema = z.object({
  schedule_id: z.number().describe('ID of the schedule to retrieve'),
});

const DeleteScheduleSchema = z.object({
  schedule_id: z.number().describe('ID of the schedule to delete'),
});

// Main function
export async function mcp(config: Record<string, string>) {
  await initializeClient(config);

  // Server implementation
  const server = new Server({
    name: 'cal-com',
    version: '1.0.0',
    capabilities: {
      tools: {},
    },
  });

  // Tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'cal_get_all_schedules',
        description: 'Retrieve all schedules from Cal.com API.',
        inputSchema: zodToJsonSchema(GetAllSchedulesSchema),
      },
      {
        name: 'cal_create_a_schedule',
        description: 'Create a new schedule in Cal.com.',
        inputSchema: zodToJsonSchema(CreateScheduleSchema),
      },
      {
        name: 'cal_update_a_schedule',
        description: 'Update an existing schedule in Cal.com.',
        inputSchema: zodToJsonSchema(UpdateScheduleSchema),
      },
      {
        name: 'cal_get_default_schedule',
        description: 'Get the default schedule from Cal.com.',
        inputSchema: zodToJsonSchema(GetDefaultScheduleSchema),
      },
      {
        name: 'cal_get_schedule',
        description: 'Get a specific schedule by its ID.',
        inputSchema: zodToJsonSchema(GetScheduleSchema),
      },
      {
        name: 'cal_delete_a_schedule',
        description: 'Delete a schedule by its ID.',
        inputSchema: zodToJsonSchema(DeleteScheduleSchema),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'cal_get_all_schedules': {
          GetAllSchedulesSchema.parse(args);
          const response = await calComClient.get('/schedules');

          const schedules = response.data.data || [];
          if (schedules.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No schedules found.',
                },
              ],
            };
          }

          const scheduleList = schedules
            .map(
              (schedule: any) =>
                `- ${schedule.name}\n  ID: ${schedule.id}\n  Time Zone: ${schedule.timeZone}\n  Default: ${schedule.isDefault || false}`
            )
            .join('\n\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${schedules.length} schedules:\n\n${scheduleList}`,
              },
            ],
          };
        }

        case 'cal_create_a_schedule': {
          const validatedArgs = CreateScheduleSchema.parse(args);
          const response = await calComClient.post('/schedules', validatedArgs);

          return {
            content: [
              {
                type: 'text',
                text: `Schedule created successfully!\nSchedule ID: ${response.data.data.id}\nName: ${response.data.data.name}\nTime Zone: ${response.data.data.timeZone}\nDefault: ${response.data.data.isDefault}`,
              },
            ],
          };
        }

        case 'cal_update_a_schedule': {
          const validatedArgs = UpdateScheduleSchema.parse(args);
          const { schedule_id, ...updateData } = validatedArgs;

          const response = await calComClient.patch(`/schedules/${schedule_id}`, updateData);

          return {
            content: [
              {
                type: 'text',
                text: `Schedule updated successfully!\nSchedule ID: ${response.data.data.id}\nName: ${response.data.data.name}\nTime Zone: ${response.data.data.timeZone}`,
              },
            ],
          };
        }

        case 'cal_get_default_schedule': {
          GetDefaultScheduleSchema.parse(args);
          const response = await calComClient.get('/schedules?isDefault=true');

          const defaultSchedule = response.data.data?.[0];
          if (!defaultSchedule) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No default schedule found.',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Default Schedule:\nID: ${defaultSchedule.id}\nName: ${defaultSchedule.name}\nTime Zone: ${defaultSchedule.timeZone}\nAvailability: ${JSON.stringify(defaultSchedule.availability, null, 2)}`,
              },
            ],
          };
        }

        case 'cal_get_schedule': {
          const validatedArgs = GetScheduleSchema.parse(args);
          const response = await calComClient.get(`/schedules/${validatedArgs.schedule_id}`);

          const schedule = response.data.data;
          return {
            content: [
              {
                type: 'text',
                text: `Schedule Details:\nID: ${schedule.id}\nName: ${schedule.name}\nTime Zone: ${schedule.timeZone}\nDefault: ${schedule.isDefault}\nAvailability: ${JSON.stringify(schedule.availability, null, 2)}`,
              },
            ],
          };
        }

        case 'cal_delete_a_schedule': {
          const validatedArgs = DeleteScheduleSchema.parse(args);
          await calComClient.delete(`/schedules/${validatedArgs.schedule_id}`);

          return {
            content: [
              {
                type: 'text',
                text: `Schedule ${validatedArgs.schedule_id} deleted successfully`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
          };
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}
