import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getMixpanelClient, getDataClient, MixpanelConfig, parseNDJSON, formatDate } from '../utils';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const GetEventCountsSchema = z.object({
  event: z.string().describe('Event name to count (e.g. "Signed Up", "$pageview")'),
  from_date: z.string().describe('Start date in YYYY-MM-DD format'),
  to_date: z.string().describe('End date in YYYY-MM-DD format'),
  unit: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional().default('day').describe('Time bucket unit'),
  group_by: z.string().optional().describe('Property name to segment by (e.g. "browser", "$country_code")'),
});

const GetTopEventsSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of top events to return (default: 20)'),
  type: z.enum(['general', 'average', 'unique']).optional().default('general').describe('Count type'),
});

const ExportEventsSchema = z.object({
  event: z.string().optional().describe('Filter by event name. Omit to export all events.'),
  from_date: z.string().describe('Start date in YYYY-MM-DD format'),
  to_date: z.string().describe('End date in YYYY-MM-DD format'),
  limit: z.number().optional().default(50).describe('Max number of events to return (default: 50)'),
  where: z.string().optional().describe('Filter expression (e.g. \'properties["$country_code"] == "US"\')'),
});

const SearchUsersSchema = z.object({
  search: z.string().optional().describe('Search query — matches against name, email, or distinct_id'),
  limit: z.number().optional().default(20).describe('Max profiles to return (default: 20)'),
});

const GetUserSchema = z.object({
  distinct_id: z.string().describe('Distinct ID of the user to look up'),
});

const ListFunnelsSchema = z.object({});

const GetFunnelSchema = z.object({
  funnel_id: z.number().describe('Numeric ID of the funnel'),
  from_date: z.string().describe('Start date in YYYY-MM-DD format'),
  to_date: z.string().describe('End date in YYYY-MM-DD format'),
  unit: z.enum(['day', 'week', 'month']).optional().default('day').describe('Time bucket unit'),
});

const GetRetentionSchema = z.object({
  from_date: z.string().describe('Start date in YYYY-MM-DD format'),
  to_date: z.string().describe('End date in YYYY-MM-DD format'),
  born_event: z.string().optional().default('$default').describe('The first event (birth event) for the cohort'),
  retention_type: z.enum(['birth', 'compounded']).optional().default('birth'),
  unit: z.enum(['day', 'week', 'month']).optional().default('day'),
  interval_count: z.number().optional().default(7).describe('Number of intervals to return'),
});

const ListAnnotationsSchema = z.object({
  limit: z.number().optional().default(50).describe('Max annotations to return'),
});

const CreateAnnotationSchema = z.object({
  description: z.string().describe('Text content of the annotation'),
  date: z.string().describe('ISO 8601 date for the annotation (e.g. "2025-01-15T10:00:00")'),
});

// ─── Pre-convert schemas ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (schema: z.ZodTypeAny) => zodToJsonSchema(schema) as any;

// ─── Tool list ─────────────────────────────────────────────────────────────────

export function getTools() {
  return [
    {
      name: 'mixpanel_get_event_counts',
      description:
        'Get the count of a specific event over a date range. Optionally segment by a user or event property. Great for tracking daily actives, signups, or any key metric over time.',
      inputSchema: s(GetEventCountsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_get_top_events',
      description:
        'Get the most frequently occurring events in the project. Useful for a quick overview of what events are firing the most.',
      inputSchema: s(GetTopEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_export_events',
      description:
        'Export raw event records for a date range. Optionally filter by event name or a where expression. Returns up to 50 events.',
      inputSchema: s(ExportEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_search_users',
      description:
        'Search user profiles (People) in the Mixpanel project. Filter by name, email, or distinct_id.',
      inputSchema: s(SearchUsersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_get_user',
      description:
        'Get the full profile of a specific user by their distinct_id, including all custom and default properties.',
      inputSchema: s(GetUserSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_list_funnels',
      description:
        'List all saved funnels in the Mixpanel project with their IDs and names.',
      inputSchema: s(ListFunnelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_get_funnel',
      description:
        'Get conversion data for a specific funnel over a date range — steps, entry count, completion count, and overall conversion rate.',
      inputSchema: s(GetFunnelSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_get_retention',
      description:
        'Get user retention cohort data. Returns how many users who performed the birth event came back over subsequent intervals.',
      inputSchema: s(GetRetentionSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_list_annotations',
      description:
        'List timeline annotations in the project — notes marking releases, incidents, or experiments.',
      inputSchema: s(ListAnnotationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'mixpanel_create_annotation',
      description:
        'Add an annotation to the project timeline to mark a deployment, experiment, or notable event.',
      inputSchema: s(CreateAnnotationSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ─── Tool runner ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool(name: string, args: Record<string, any>, config: MixpanelConfig): Promise<any> {
  const client = getMixpanelClient(config);
  const dataClient = getDataClient(config);
  const projectId = config.project_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ok = (data: any) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
  const err = (msg: string) => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });

  try {
    switch (name) {
      case 'mixpanel_get_event_counts': {
        const { event, from_date, to_date, unit, group_by } = GetEventCountsSchema.parse(args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = {
          project_id: projectId,
          event: JSON.stringify([event]),
          from_date,
          to_date,
          unit,
          type: 'general',
        };
        if (group_by) params.on = `properties["${group_by}"]`;

        const response = await client.get('/api/2.0/segmentation', { params });
        return ok(response.data);
      }

      case 'mixpanel_get_top_events': {
        const { limit, type } = GetTopEventsSchema.parse(args);
        const today = formatDate(new Date());
        const weekAgo = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

        const response = await client.get('/api/2.0/events/top', {
          params: { project_id: projectId, type, limit, from_date: weekAgo, to_date: today },
        });
        return ok(response.data);
      }

      case 'mixpanel_export_events': {
        const { event, from_date, to_date, limit, where } = ExportEventsSchema.parse(args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = {
          project_id: projectId,
          from_date,
          to_date,
        };
        if (event) params.event = JSON.stringify([event]);
        if (where) params.where = where;

        const response = await dataClient.get('/api/2.0/export', { params, responseType: 'text' });
        const events = parseNDJSON(response.data as string).slice(0, limit);
        return ok({ count: events.length, events });
      }

      case 'mixpanel_search_users': {
        const { search, limit } = SearchUsersSchema.parse(args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = { project_id: projectId, page_size: limit };
        if (search) {
          params.where = `(properties["$email"] == "${search}") or (properties["$name"] == "${search}") or (properties["$distinct_id"] == "${search}")`;
        }

        const response = await client.get('/api/2.0/engage', { params });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profiles = (response.data?.results as Record<string, any>[]) ?? [];
        const results = profiles.map((p) => ({
          distinct_id: p['$distinct_id'],
          name: p['$properties']?.['$name'],
          email: p['$properties']?.['$email'],
          last_seen: p['$properties']?.['$last_seen'],
          properties: p['$properties'],
        }));
        return ok({ count: results.length, results });
      }

      case 'mixpanel_get_user': {
        const { distinct_id } = GetUserSchema.parse(args);
        const response = await client.get('/api/2.0/engage', {
          params: {
            project_id: projectId,
            where: `properties["$distinct_id"] == "${distinct_id}"`,
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = (response.data?.results as Record<string, any>[]) ?? [];
        if (results.length === 0) return err(`No user found with distinct_id: ${distinct_id}`);

        const p = results[0];
        return ok({
          distinct_id: p['$distinct_id'],
          name: p['$properties']?.['$name'],
          email: p['$properties']?.['$email'],
          last_seen: p['$properties']?.['$last_seen'],
          properties: p['$properties'],
        });
      }

      case 'mixpanel_list_funnels': {
        const response = await client.get('/api/2.0/funnels/list', {
          params: { project_id: projectId },
        });
        return ok(response.data);
      }

      case 'mixpanel_get_funnel': {
        const { funnel_id, from_date, to_date, unit } = GetFunnelSchema.parse(args);
        const response = await client.get('/api/2.0/funnels', {
          params: { project_id: projectId, funnel_id, from_date, to_date, unit },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = response.data as Record<string, any>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (data['meta'] as Record<string, any>) ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const steps: Record<string, any>[] = (meta['steps'] as Record<string, any>[]) ?? [];

        const firstStep = steps[0];
        const lastStep = steps[steps.length - 1];
        const entered = (firstStep?.['count'] as number) ?? 0;
        const completed = (lastStep?.['count'] as number) ?? 0;
        const conversionRate = entered > 0 ? ((completed / entered) * 100).toFixed(1) : '0';

        return ok({
          funnel_id,
          period: `${from_date} → ${to_date}`,
          steps: steps.map((s, i) => ({
            step: i + 1,
            event: s['event'],
            count: s['count'],
            conversion_from_previous: s['step_conv_ratio'] ? `${(s['step_conv_ratio'] * 100).toFixed(1)}%` : null,
          })),
          entered,
          completed,
          overall_conversion: `${conversionRate}%`,
          raw: data,
        });
      }

      case 'mixpanel_get_retention': {
        const { from_date, to_date, born_event, retention_type, unit, interval_count } = GetRetentionSchema.parse(args);
        const response = await client.get('/api/2.0/retention', {
          params: {
            project_id: projectId,
            from_date,
            to_date,
            retention_type,
            born_event,
            interval: 1,
            interval_count,
            unit,
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = response.data as Record<string, any>;
        const cohorts = Object.entries(data).slice(0, 10).map(([date, cohort]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = cohort as Record<string, any>;
          const counts = (c['counts'] as number[]) ?? [];
          const initial = counts[0] ?? 0;
          return {
            cohort_date: date,
            initial_users: initial,
            retention: counts.map((count, i) => ({
              interval: i,
              users: count,
              rate: initial > 0 ? `${((count / initial) * 100).toFixed(1)}%` : '0%',
            })),
          };
        });

        return ok({ period: `${from_date} → ${to_date}`, unit, cohorts });
      }

      case 'mixpanel_list_annotations': {
        const { limit } = ListAnnotationsSchema.parse(args);
        const response = await client.get('/api/2.0/annotations', {
          params: { project_id: projectId },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = ((response.data as Record<string, any>)?.['results'] as Record<string, any>[]) ?? [];
        return ok(results.slice(0, limit).map((a) => ({
          id: a['id'],
          description: a['description'],
          date: a['date'],
          author: a['login_name'],
        })));
      }

      case 'mixpanel_create_annotation': {
        const { description, date } = CreateAnnotationSchema.parse(args);
        const response = await client.post('/api/2.0/annotations/create', {
          project_id: projectId,
          description,
          date,
        });
        return ok(response.data);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = error as any;
    const message = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Unknown error';
    return err(message);
  }
}
