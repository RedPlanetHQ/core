import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { initializeClient, getWhoopData, getPaginatedWhoopData } from '../utils';

// ── Schema definitions ────────────────────────────────────────────────────────

const DateRangeSchema = z.object({
  start: z
    .string()
    .optional()
    .describe('ISO 8601 start datetime (e.g. 2024-01-01T00:00:00Z). Defaults to 7 days ago.'),
  end: z.string().optional().describe('ISO 8601 end datetime. Defaults to now.'),
  limit: z.number().optional().describe('Maximum number of records to return (default 25).'),
});

const GetSleepSchema = DateRangeSchema;
const GetRecoverySchema = DateRangeSchema;
const GetWorkoutsSchema = DateRangeSchema;
const GetCyclesSchema = DateRangeSchema;

const GetBodyMeasurementSchema = z.object({});

// ── Tool list ─────────────────────────────────────────────────────────────────

const tools = [
  {
    name: 'whoop_get_profile',
    description: "Get the authenticated user's Whoop profile (name, email, user ID).",
    inputSchema: zodToJsonSchema(z.object({})),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'whoop_get_body_measurement',
    description: "Get the user's body measurements (height, weight, max heart rate) from Whoop.",
    inputSchema: zodToJsonSchema(GetBodyMeasurementSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'whoop_get_sleep',
    description:
      'Get Whoop sleep records including sleep performance, efficiency, and stage breakdown (REM, deep, light sleep).',
    inputSchema: zodToJsonSchema(GetSleepSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'whoop_get_recovery',
    description:
      'Get Whoop recovery scores including HRV, resting heart rate, SpO2, and overall recovery percentage.',
    inputSchema: zodToJsonSchema(GetRecoverySchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'whoop_get_workouts',
    description:
      'Get Whoop workout records including sport, strain score, heart rate, and calorie data.',
    inputSchema: zodToJsonSchema(GetWorkoutsSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'whoop_get_cycles',
    description:
      'Get Whoop physiological cycles (days) with strain, kilojoules burned, and average/max heart rate.',
    inputSchema: zodToJsonSchema(GetCyclesSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
];

export async function getTools() {
  return tools;
}

// ── Tool implementations ──────────────────────────────────────────────────────

function defaultStart(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function buildParams(args: { start?: string; end?: string; limit?: number }) {
  const params: Record<string, string | number> = {};
  if (args.start) params['start'] = args.start;
  if (args.end) params['end'] = args.end;
  if (args.limit) params['limit'] = args.limit;
  return params;
}

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  credentials: Record<string, string>
) {
  try {
    initializeClient(credentials.access_token);

    switch (name) {
      case 'whoop_get_profile': {
        const data = await getWhoopData('/v1/user/profile/basic');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'whoop_get_body_measurement': {
        const data = await getWhoopData('/v1/user/measurement/body');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'whoop_get_sleep': {
        const validated = GetSleepSchema.parse(args);
        const params = buildParams({ start: validated.start ?? defaultStart(), ...validated });
        const records = await getPaginatedWhoopData('/v1/activity/sleep', params);
        return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
      }

      case 'whoop_get_recovery': {
        const validated = GetRecoverySchema.parse(args);
        const params = buildParams({ start: validated.start ?? defaultStart(), ...validated });
        const records = await getPaginatedWhoopData('/v1/recovery', params);
        return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
      }

      case 'whoop_get_workouts': {
        const validated = GetWorkoutsSchema.parse(args);
        const params = buildParams({ start: validated.start ?? defaultStart(), ...validated });
        const records = await getPaginatedWhoopData('/v1/activity/workout', params);
        return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
      }

      case 'whoop_get_cycles': {
        const validated = GetCyclesSchema.parse(args);
        const params = buildParams({ start: validated.start ?? defaultStart(), ...validated });
        const records = await getPaginatedWhoopData('/v1/cycle', params);
        return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${error.message}` }],
      isError: true,
    };
  }
}
