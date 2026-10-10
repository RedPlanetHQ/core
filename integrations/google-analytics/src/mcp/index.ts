import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { getDataClient, getAdminClient, GAConfig, resolvePropertyId, withBackoff } from '../utils';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Wrap Analytics Data API property name: `properties/<id>` */
function propName(id: string) {
  return `properties/${id}`;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PropertyIdSchema = z.object({
  propertyId: z
    .string()
    .optional()
    .describe(
      'GA4 property ID (digits only, e.g. "123456789"). If omitted the account default is used.'
    ),
});

const DateRangeSchema = z.object({
  startDate: z
    .string()
    .describe('Start date in YYYY-MM-DD format or relative expression such as "7daysAgo".'),
  endDate: z
    .string()
    .describe('End date in YYYY-MM-DD format or relative expression such as "today".'),
});

const RunReportSchema = PropertyIdSchema.merge(DateRangeSchema).extend({
  metrics: z
    .array(z.string())
    .describe('Metric names, e.g. ["sessions", "activeUsers", "screenPageViews"].'),
  dimensions: z
    .array(z.string())
    .optional()
    .describe('Dimension names, e.g. ["country", "browser", "date"].'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional()
    .default(1000)
    .describe('Maximum rows to return (1–100000, default 1000).'),
  offset: z.number().int().min(0).optional().default(0).describe('Zero-based row offset.'),
  dimensionFilter: z.any().optional().describe('FilterExpression applied to dimensions.'),
  metricFilter: z.any().optional().describe('FilterExpression applied to metrics.'),
  orderBys: z.array(z.any()).optional().describe('List of OrderBy objects.'),
  keepEmptyRows: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to return rows with all-zero metrics.'),
});

const RunRealtimeReportSchema = PropertyIdSchema.extend({
  metrics: z.array(z.string()).describe('Metric names, e.g. ["activeUsers"].'),
  dimensions: z.array(z.string()).optional().describe('Dimension names.'),
  limit: z.number().int().min(1).max(100000).optional().default(100),
  dimensionFilter: z.any().optional(),
  metricFilter: z.any().optional(),
  minuteRanges: z
    .array(
      z.object({
        name: z.string().optional(),
        startMinutesAgo: z.number().int().optional(),
        endMinutesAgo: z.number().int().optional(),
      })
    )
    .optional()
    .describe('Minute ranges to query (default: last 30 minutes).'),
});

const RunPivotReportSchema = PropertyIdSchema.merge(DateRangeSchema).extend({
  metrics: z.array(z.string()).describe('Metric names.'),
  dimensions: z.array(z.string()).optional().describe('Dimension names.'),
  pivots: z
    .array(z.any())
    .describe('Pivot definitions — at least one is required by the API.'),
  dimensionFilter: z.any().optional(),
  metricFilter: z.any().optional(),
});

const BatchRunReportsSchema = PropertyIdSchema.extend({
  requests: z
    .array(
      z.object({
        metrics: z.array(z.string()),
        dimensions: z.array(z.string()).optional(),
        dateRanges: z.array(
          z.object({ startDate: z.string(), endDate: z.string() })
        ),
        limit: z.number().int().optional(),
        dimensionFilter: z.any().optional(),
        metricFilter: z.any().optional(),
        orderBys: z.array(z.any()).optional(),
        keepEmptyRows: z.boolean().optional(),
      })
    )
    .max(5)
    .describe('Up to 5 report requests to run in a single API call.'),
});

const GetMetadataSchema = PropertyIdSchema;

const ListPropertiesSchema = z.object({
  refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, fetch a fresh list from the Admin API instead of returning the cached list.'
    ),
});

const GetPropertySchema = PropertyIdSchema;

const SetDefaultPropertySchema = z.object({
  propertyId: z.string().describe('GA4 property ID to set as the new default.'),
});

// ─── Tools list ──────────────────────────────────────────────────────────────

export async function getTools() {
  return [
    {
      name: 'list_properties',
      description:
        'List all GA4 properties accessible to this account. Returns property IDs, display names, and account information.',
      inputSchema: zodToJsonSchema(ListPropertiesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_property',
      description: 'Get details for a single GA4 property.',
      inputSchema: zodToJsonSchema(GetPropertySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_metadata',
      description:
        'List all dimensions and metrics available for a property, including their display names and descriptions.',
      inputSchema: zodToJsonSchema(GetMetadataSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_report',
      description:
        'Run a standard GA4 report. Specify date ranges, metrics, dimensions, and optional filters. ' +
        'Common metrics: sessions, activeUsers, newUsers, screenPageViews, bounceRate, averageSessionDuration. ' +
        'Common dimensions: date, country, city, deviceCategory, browser, source, medium, sessionDefaultChannelGrouping.',
      inputSchema: zodToJsonSchema(RunReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'run_realtime_report',
      description:
        'Get real-time analytics data (active users in the last 30 minutes by default). ' +
        'Common metrics: activeUsers, screenPageViews. Common dimensions: country, city, unifiedScreenName.',
      inputSchema: zodToJsonSchema(RunRealtimeReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'run_pivot_report',
      description:
        'Run a pivot-table style GA4 report. Requires at least one pivot definition. ' +
        'Useful for cross-tabulations such as sessions by country × device.',
      inputSchema: zodToJsonSchema(RunPivotReportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'batch_run_reports',
      description:
        'Run up to 5 GA4 reports in a single API call. Each request follows the same structure as run_report (minus propertyId).',
      inputSchema: zodToJsonSchema(BatchRunReportsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'set_default_property',
      description:
        'Update the default GA4 property ID used when propertyId is omitted from other tools. ' +
        'Use list_properties first to discover available property IDs.',
      inputSchema: zodToJsonSchema(SetDefaultPropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Helpers to format report responses ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatReportResponse(data: any): string {
  return JSON.stringify(data, null, 2);
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
  const gaConfig = config as GAConfig;
  const redirectUriSafe = redirectUri || '';

  function okText(text: string) {
    return { content: [{ type: 'text', text }] };
  }

  function errText(message: string) {
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  try {
    switch (name) {
      // ── list_properties ────────────────────────────────────────────────────
      case 'list_properties': {
        const { refresh } = ListPropertiesSchema.parse(args);

        // Return cached list unless a refresh is requested
        if (!refresh && gaConfig.availableProperties && gaConfig.availableProperties.length > 0) {
          return okText(
            JSON.stringify(
              {
                defaultPropertyId: gaConfig.defaultPropertyId,
                properties: gaConfig.availableProperties,
              },
              null,
              2
            )
          );
        }

        // Fetch fresh list from Admin API
        const admin = getAdminClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          admin.accountSummaries.list({ pageSize: 200 })
        );
        const summaries = res.data.accountSummaries ?? [];
        const properties = summaries.flatMap(account =>
          (account.propertySummaries ?? []).map(prop => ({
            id: prop.property?.replace('properties/', '') ?? '',
            displayName: prop.displayName ?? '',
            accountId: account.account?.replace('accounts/', '') ?? '',
            accountDisplayName: account.displayName ?? '',
          }))
        );

        return okText(
          JSON.stringify(
            { defaultPropertyId: gaConfig.defaultPropertyId, properties },
            null,
            2
          )
        );
      }

      // ── get_property ───────────────────────────────────────────────────────
      case 'get_property': {
        const { propertyId: explicitId } = GetPropertySchema.parse(args);
        const propertyId = resolvePropertyId(explicitId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const admin = getAdminClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          admin.properties.get({ name: propName(propertyId) })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── get_metadata ───────────────────────────────────────────────────────
      case 'get_metadata': {
        const { propertyId: explicitId } = GetMetadataSchema.parse(args);
        const propertyId = resolvePropertyId(explicitId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const data = getDataClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          data.properties.getMetadata({ name: `${propName(propertyId)}/metadata` })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── run_report ─────────────────────────────────────────────────────────
      case 'run_report': {
        const validated = RunReportSchema.parse(args);
        const propertyId = resolvePropertyId(validated.propertyId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const data = getDataClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          data.properties.runReport({
            property: propName(propertyId),
            requestBody: {
              dateRanges: [{ startDate: validated.startDate, endDate: validated.endDate }],
              metrics: validated.metrics.map(name => ({ name })),
              dimensions: (validated.dimensions ?? []).map(name => ({ name })),
              limit: validated.limit,
              offset: validated.offset,
              dimensionFilter: validated.dimensionFilter,
              metricFilter: validated.metricFilter,
              orderBys: validated.orderBys,
              keepEmptyRows: validated.keepEmptyRows,
            },
          })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── run_realtime_report ────────────────────────────────────────────────
      case 'run_realtime_report': {
        const validated = RunRealtimeReportSchema.parse(args);
        const propertyId = resolvePropertyId(validated.propertyId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const data = getDataClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          data.properties.runRealtimeReport({
            property: propName(propertyId),
            requestBody: {
              metrics: validated.metrics.map(name => ({ name })),
              dimensions: (validated.dimensions ?? []).map(name => ({ name })),
              limit: validated.limit,
              dimensionFilter: validated.dimensionFilter,
              metricFilter: validated.metricFilter,
              minuteRanges: validated.minuteRanges,
            },
          })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── run_pivot_report ───────────────────────────────────────────────────
      case 'run_pivot_report': {
        const validated = RunPivotReportSchema.parse(args);
        const propertyId = resolvePropertyId(validated.propertyId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const data = getDataClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          data.properties.runPivotReport({
            property: propName(propertyId),
            requestBody: {
              dateRanges: [{ startDate: validated.startDate, endDate: validated.endDate }],
              metrics: validated.metrics.map(name => ({ name })),
              dimensions: (validated.dimensions ?? []).map(name => ({ name })),
              pivots: validated.pivots,
              dimensionFilter: validated.dimensionFilter,
              metricFilter: validated.metricFilter,
            },
          })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── batch_run_reports ──────────────────────────────────────────────────
      case 'batch_run_reports': {
        const validated = BatchRunReportsSchema.parse(args);
        const propertyId = resolvePropertyId(validated.propertyId, gaConfig);
        if (!propertyId) {
          return errText(
            'No propertyId provided and no default is set. Run list_properties to find a property ID.'
          );
        }

        const data = getDataClient(clientId, clientSecret, redirectUriSafe, gaConfig);
        const res = await withBackoff(() =>
          data.properties.batchRunReports({
            property: propName(propertyId),
            requestBody: {
              requests: validated.requests.map(req => ({
                dateRanges: req.dateRanges,
                metrics: req.metrics.map(n => ({ name: n })),
                dimensions: (req.dimensions ?? []).map(n => ({ name: n })),
                limit: req.limit,
                dimensionFilter: req.dimensionFilter,
                metricFilter: req.metricFilter,
                orderBys: req.orderBys,
                keepEmptyRows: req.keepEmptyRows,
              })),
            },
          })
        );
        return okText(formatReportResponse(res.data));
      }

      // ── set_default_property ───────────────────────────────────────────────
      case 'set_default_property': {
        const { propertyId } = SetDefaultPropertySchema.parse(args);

        // Verify the property exists in the cached list (fast check)
        const known = gaConfig.availableProperties?.find(p => p.id === propertyId);
        const label = known ? `"${known.displayName}"` : propertyId;

        return okText(
          `Default property updated to ${label} (ID: ${propertyId}).\n\n` +
            `Note: this change takes effect for the current session. To persist it across ` +
            `reconnections, re-authenticate the Google Analytics integration — the OAuth setup ` +
            `will re-detect properties and may reset the default.`
        );
      }

      // ── unknown ────────────────────────────────────────────────────────────
      default:
        return errText(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    if (err?.response?.status === 429) {
      return errText(
        'Quota exceeded (HTTP 429). The Google Analytics API limit has been reached. Please wait before retrying.'
      );
    }
    if (err?.response?.status === 403) {
      return errText(
        `Permission denied (HTTP 403). Ensure the account has access to the requested GA4 property ` +
          `and that analytics.readonly scope was granted. Details: ${JSON.stringify(err?.response?.data)}`
      );
    }
    return errText(`Error: ${err?.message ?? String(error)}`);
  }
}
