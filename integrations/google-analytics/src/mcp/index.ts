import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { GA4_ADMIN_BASE, GA4_DATA_BASE, GAConfig, gaGet, gaPost } from '../utils';

// ─── Common field schemas ────────────────────────────────────────────────────

const PropertyIdSchema = z.object({
  propertyId: z
    .string()
    .describe(
      'The GA4 property ID. Prefix with "properties/" is optional — e.g. "123456789" or "properties/123456789".'
    ),
});

const DateRangeSchema = z.object({
  startDate: z
    .string()
    .describe('Start date in YYYY-MM-DD format, or relative values like "7daysAgo", "yesterday".'),
  endDate: z
    .string()
    .describe('End date in YYYY-MM-DD format, or relative values like "today", "yesterday".'),
});

const RunReportSchema = PropertyIdSchema.merge(DateRangeSchema).extend({
  dimensions: z
    .array(z.string())
    .optional()
    .describe(
      'List of dimension names (e.g. ["date", "city", "sessionSource"]). See GA4 dimensions reference.'
    ),
  metrics: z
    .array(z.string())
    .optional()
    .describe(
      'List of metric names (e.g. ["sessions", "activeUsers", "screenPageViews"]). See GA4 metrics reference.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum number of rows to return (1–250000, default 1000).'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Zero-based row offset for pagination.'),
  dimensionFilter: z
    .record(z.unknown())
    .optional()
    .describe('Optional dimension filter expression object following the GA4 filter spec.'),
  metricFilter: z
    .record(z.unknown())
    .optional()
    .describe('Optional metric filter expression object following the GA4 filter spec.'),
  orderBys: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('Optional ordering for the report rows.'),
  keepEmptyRows: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, rows where all metric values are zero will be included.'),
});

const RunRealtimeReportSchema = PropertyIdSchema.extend({
  dimensions: z
    .array(z.string())
    .optional()
    .describe('List of realtime dimension names (e.g. ["city", "unifiedScreenName"]).'),
  metrics: z
    .array(z.string())
    .optional()
    .describe('List of realtime metric names (e.g. ["activeUsers", "eventCount"]).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum number of rows to return.'),
  dimensionFilter: z
    .record(z.unknown())
    .optional()
    .describe('Optional dimension filter expression.'),
  metricFilter: z.record(z.unknown()).optional().describe('Optional metric filter expression.'),
  minuteRanges: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('Minute ranges to include. Defaults to the last 30 minutes if omitted.'),
});

const RunPivotReportSchema = PropertyIdSchema.merge(DateRangeSchema).extend({
  dimensions: z.array(z.string()).optional().describe('Dimension names for the pivot report.'),
  metrics: z.array(z.string()).optional().describe('Metric names for the pivot report.'),
  pivots: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('Pivot definitions describing which dimensions to pivot on.'),
  dimensionFilter: z.record(z.unknown()).optional().describe('Optional dimension filter.'),
  metricFilter: z.record(z.unknown()).optional().describe('Optional metric filter.'),
});

const GetMetadataSchema = PropertyIdSchema;

const CheckCompatibilitySchema = PropertyIdSchema.extend({
  dimensions: z
    .array(z.string())
    .optional()
    .describe('Dimension names to check compatibility for.'),
  metrics: z.array(z.string()).optional().describe('Metric names to check compatibility for.'),
  compatibilityFilter: z
    .enum(['COMPATIBLE', 'INCOMPATIBLE'])
    .optional()
    .describe('Filter to return only COMPATIBLE or INCOMPATIBLE items.'),
});

const ListPropertiesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Optional filter string. E.g. "parent:accounts/123456789" to list properties for a specific account.'
    ),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of properties to return per page (1–200, default 50).'),
  pageToken: z.string().optional().describe('Page token for pagination from a previous response.'),
});

const ListAccountsSchema = z.object({
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of accounts to return per page (1–200, default 50).'),
  pageToken: z.string().optional().describe('Page token for pagination from a previous response.'),
});

const RunFunnelReportSchema = PropertyIdSchema.merge(DateRangeSchema).extend({
  funnel: z
    .record(z.unknown())
    .describe(
      'The funnel definition object. Each step has a name and filterExpression. See GA4 funnel report reference.'
    ),
  funnelBreakdown: z
    .record(z.unknown())
    .optional()
    .describe('Optional breakdown dimension for the funnel.'),
  funnelNextAction: z
    .record(z.unknown())
    .optional()
    .describe('Optional next action dimension for the funnel.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum rows to return.'),
  offset: z.number().int().min(0).optional().default(0).describe('Row offset for pagination.'),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalisePropertyId(raw: string): string {
  return raw.startsWith('properties/') ? raw : `properties/${raw}`;
}

function okResponse(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errResponse(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Tools list ──────────────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'list_accounts',
      description: 'List all Google Analytics accounts accessible to the authenticated user.',
      inputSchema: zodToJsonSchema(ListAccountsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_properties',
      description:
        'List GA4 properties. Filter by account with filter="parent:accounts/{accountId}".',
      inputSchema: zodToJsonSchema(ListPropertiesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_report',
      description:
        'Run a standard GA4 analytics report for a property. Supports dimensions, metrics, date ranges, filters, and pagination.',
      inputSchema: zodToJsonSchema(RunReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_realtime_report',
      description:
        'Run a real-time GA4 report showing active users and events in the last 30 minutes.',
      inputSchema: zodToJsonSchema(RunRealtimeReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_pivot_report',
      description:
        'Run a GA4 pivot report that pivots dimension values into columns, useful for cross-tabulation analysis.',
      inputSchema: zodToJsonSchema(RunPivotReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_funnel_report',
      description:
        'Run a GA4 funnel report to analyse sequential user actions and conversion paths.',
      inputSchema: zodToJsonSchema(RunFunnelReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_metadata',
      description:
        'Get available dimensions and metrics for a GA4 property, including custom dimensions and metrics.',
      inputSchema: zodToJsonSchema(GetMetadataSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'check_compatibility',
      description:
        'Check which dimensions and metrics are compatible with each other in a GA4 report request.',
      inputSchema: zodToJsonSchema(CheckCompatibilitySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any
) {
  const gaConfig: GAConfig = {
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    client_id: clientId || config.client_id,
    client_secret: clientSecret || config.client_secret,
    expires_at: config.expires_at,
    scope: config.scope,
    redirect_uri: redirectUri || config.redirect_uri,
  };

  try {
    switch (name) {
      case 'list_accounts': {
        const validated = ListAccountsSchema.parse(args);
        const params: Record<string, string> = {
          pageSize: String(validated.pageSize ?? 50),
        };
        if (validated.pageToken) {
          params['pageToken'] = validated.pageToken;
        }
        const data = await gaGet(`${GA4_ADMIN_BASE}/accounts`, gaConfig, params);
        return okResponse(data);
      }

      case 'list_properties': {
        const validated = ListPropertiesSchema.parse(args);
        const params: Record<string, string> = {
          pageSize: String(validated.pageSize ?? 50),
        };
        if (validated.filter) {
          params['filter'] = validated.filter;
        }
        if (validated.pageToken) {
          params['pageToken'] = validated.pageToken;
        }
        const data = await gaGet(`${GA4_ADMIN_BASE}/properties`, gaConfig, params);
        return okResponse(data);
      }

      case 'run_report': {
        const validated = RunReportSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          dateRanges: [{ startDate: validated.startDate, endDate: validated.endDate }],
          limit: validated.limit ?? 1000,
          offset: validated.offset ?? 0,
          keepEmptyRows: validated.keepEmptyRows ?? false,
        };
        if (validated.dimensions?.length) {
          body['dimensions'] = validated.dimensions.map(d => ({ name: d }));
        }
        if (validated.metrics?.length) {
          body['metrics'] = validated.metrics.map(m => ({ name: m }));
        }
        if (validated.dimensionFilter) {
          body['dimensionFilter'] = validated.dimensionFilter;
        }
        if (validated.metricFilter) {
          body['metricFilter'] = validated.metricFilter;
        }
        if (validated.orderBys?.length) {
          body['orderBys'] = validated.orderBys;
        }
        const data = await gaPost(`${GA4_DATA_BASE}/${propertyId}:runReport`, gaConfig, body);
        return okResponse(data);
      }

      case 'run_realtime_report': {
        const validated = RunRealtimeReportSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          limit: validated.limit ?? 1000,
        };
        if (validated.dimensions?.length) {
          body['dimensions'] = validated.dimensions.map(d => ({ name: d }));
        }
        if (validated.metrics?.length) {
          body['metrics'] = validated.metrics.map(m => ({ name: m }));
        }
        if (validated.dimensionFilter) {
          body['dimensionFilter'] = validated.dimensionFilter;
        }
        if (validated.metricFilter) {
          body['metricFilter'] = validated.metricFilter;
        }
        if (validated.minuteRanges?.length) {
          body['minuteRanges'] = validated.minuteRanges;
        }
        const data = await gaPost(
          `${GA4_DATA_BASE}/${propertyId}:runRealtimeReport`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      case 'run_pivot_report': {
        const validated = RunPivotReportSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          dateRanges: [{ startDate: validated.startDate, endDate: validated.endDate }],
        };
        if (validated.dimensions?.length) {
          body['dimensions'] = validated.dimensions.map(d => ({ name: d }));
        }
        if (validated.metrics?.length) {
          body['metrics'] = validated.metrics.map(m => ({ name: m }));
        }
        if (validated.pivots?.length) {
          body['pivots'] = validated.pivots;
        }
        if (validated.dimensionFilter) {
          body['dimensionFilter'] = validated.dimensionFilter;
        }
        if (validated.metricFilter) {
          body['metricFilter'] = validated.metricFilter;
        }
        const data = await gaPost(`${GA4_DATA_BASE}/${propertyId}:runPivotReport`, gaConfig, body);
        return okResponse(data);
      }

      case 'run_funnel_report': {
        const validated = RunFunnelReportSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          dateRanges: [{ startDate: validated.startDate, endDate: validated.endDate }],
          funnel: validated.funnel,
          limit: validated.limit ?? 1000,
          offset: validated.offset ?? 0,
        };
        if (validated.funnelBreakdown) {
          body['funnelBreakdown'] = validated.funnelBreakdown;
        }
        if (validated.funnelNextAction) {
          body['funnelNextAction'] = validated.funnelNextAction;
        }
        const data = await gaPost(`${GA4_DATA_BASE}/${propertyId}:runFunnelReport`, gaConfig, body);
        return okResponse(data);
      }

      case 'get_metadata': {
        const validated = GetMetadataSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(`${GA4_DATA_BASE}/${propertyId}/metadata`, gaConfig);
        return okResponse(data);
      }

      case 'check_compatibility': {
        const validated = CheckCompatibilitySchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {};
        if (validated.dimensions?.length) {
          body['dimensions'] = validated.dimensions.map(d => ({ name: d }));
        }
        if (validated.metrics?.length) {
          body['metrics'] = validated.metrics.map(m => ({ name: m }));
        }
        if (validated.compatibilityFilter) {
          body['compatibilityFilter'] = validated.compatibilityFilter;
        }
        const data = await gaPost(
          `${GA4_DATA_BASE}/${propertyId}:checkCompatibility`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      default:
        return errResponse(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const err = error as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    if (err?.response?.status === 429) {
      return errResponse(
        'Quota exceeded (HTTP 429). The Google Analytics API limit has been reached. Please wait before retrying.'
      );
    }
    if (err?.response?.status === 403) {
      return errResponse(
        `Permission denied (HTTP 403): ${JSON.stringify(err?.response?.data ?? err?.message)}`
      );
    }
    return errResponse(`Error: ${err?.message ?? String(error)}`);
  }
}
