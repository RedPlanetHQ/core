import axios from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  GA4_ADMIN_ALPHA_BASE,
  GA4_ADMIN_BASE,
  GA4_DATA_ALPHA_BASE,
  GA4_DATA_BASE,
  GAConfig,
  gaGet,
  gaPatch,
  gaPost,
} from '../utils';

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

const PaginationSchema = z.object({
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of items to return per page (default 50).'),
  pageToken: z.string().optional().describe('Page token for pagination from a previous response.'),
});

// ─── Report schemas ───────────────────────────────────────────────────────────

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

// ─── Batch report schemas ─────────────────────────────────────────────────────

const BatchRunReportsSchema = PropertyIdSchema.extend({
  requests: z
    .array(z.record(z.unknown()))
    .describe(
      'Array of report request objects. Each follows the RunReport structure (dateRanges, dimensions, metrics, filters, etc.).'
    ),
});

const BatchRunPivotReportsSchema = PropertyIdSchema.extend({
  requests: z
    .array(z.record(z.unknown()))
    .describe('Array of pivot report request objects. Each follows the RunPivotReport structure.'),
});

// ─── Account schemas ──────────────────────────────────────────────────────────

const GetAccountSchema = z.object({
  accountName: z
    .string()
    .describe(
      'The account resource name. Prefix with "accounts/" is optional — e.g. "100" or "accounts/100".'
    ),
});

const GetDataSharingSettingsSchema = z.object({
  accountName: z
    .string()
    .describe('The account resource name, e.g. "accounts/100".'),
});

const ListAccountSummariesSchema = PaginationSchema;

// ─── Property admin schemas ───────────────────────────────────────────────────

const GetPropertySchema = PropertyIdSchema;

const UpdatePropertySchema = PropertyIdSchema.extend({
  displayName: z.string().optional().describe('Human-readable display name for this property.'),
  timeZone: z
    .string()
    .optional()
    .describe('Reporting time zone for this property. E.g. "America/New_York".'),
  currencyCode: z
    .string()
    .optional()
    .describe('Currency type used in monetary reports. E.g. "USD", "EUR".'),
  industryCategory: z
    .string()
    .optional()
    .describe('Industry associated with this property (e.g. "AUTOMOTIVE", "FINANCE").'),
  updateMask: z
    .string()
    .optional()
    .describe(
      'Comma-separated fields to update (e.g. "displayName,timeZone"). Omit to update all provided fields.'
    ),
});

const GetAttributionSettingsSchema = PropertyIdSchema;
const GetDataRetentionSettingsSchema = PropertyIdSchema;
const GetGoogleSignalsSettingsSchema = PropertyIdSchema;
const GetPropertyQuotasSnapshotSchema = PropertyIdSchema;

// ─── Audience schemas ─────────────────────────────────────────────────────────

const ListAudiencesSchema = PropertyIdSchema.merge(PaginationSchema);

const GetAudienceSchema = PropertyIdSchema.extend({
  audienceId: z.string().describe('The audience resource ID.'),
});

// ─── Audience list schemas (Data API v1alpha) ─────────────────────────────────

const CreateAudienceListSchema = PropertyIdSchema.extend({
  audience: z
    .string()
    .describe('The audience resource name this list is for, e.g. "properties/123/audiences/456".'),
  dimensions: z
    .array(z.object({ dimensionName: z.string() }))
    .describe('Dimensions requested and visible in the query response.'),
});

const GetAudienceListSchema = z.object({
  audienceListName: z
    .string()
    .describe('Full audience list resource name, e.g. "properties/123/audienceLists/456".'),
});

const ListAudienceListsSchema = PropertyIdSchema.merge(PaginationSchema);

const QueryAudienceListSchema = z.object({
  audienceListName: z
    .string()
    .describe('Full audience list resource name, e.g. "properties/123/audienceLists/456".'),
  offset: z.number().int().min(0).optional().default(0).describe('Row offset for pagination.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum rows to return.'),
});

// ─── Recurring audience list schemas (Data API v1alpha) ───────────────────────

const CreateRecurringAudienceListSchema = PropertyIdSchema.extend({
  audience: z.string().describe('The audience resource name for this recurring list.'),
  dimensions: z
    .array(z.object({ dimensionName: z.string() }))
    .describe('Dimensions included in the recurring audience list.'),
});

const GetRecurringAudienceListSchema = z.object({
  recurringAudienceListName: z
    .string()
    .describe(
      'Full recurring audience list resource name, e.g. "properties/123/recurringAudienceLists/456".'
    ),
});

const ListRecurringAudienceListsSchema = PropertyIdSchema.merge(PaginationSchema);

// ─── Audience export schemas (Data API v1beta) ────────────────────────────────

const CreateAudienceExportSchema = PropertyIdSchema.extend({
  audience: z
    .string()
    .describe(
      'The audience resource name this export is for, e.g. "properties/123/audiences/456".'
    ),
  dimensions: z
    .array(z.object({ dimensionName: z.string() }))
    .describe('Dimensions requested and visible in the query response.'),
});

const GetAudienceExportSchema = z.object({
  audienceExportName: z
    .string()
    .describe('Full audience export resource name, e.g. "properties/123/audienceExports/456".'),
});

const ListAudienceExportsSchema = PropertyIdSchema.merge(PaginationSchema);

const QueryAudienceExportSchema = z.object({
  audienceExportName: z
    .string()
    .describe('Full audience export resource name, e.g. "properties/123/audienceExports/456".'),
  offset: z.number().int().min(0).optional().default(0).describe('Row offset for pagination.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum rows to return.'),
});

// ─── Report task schemas (Data API v1alpha) ───────────────────────────────────

const CreateReportTaskSchema = PropertyIdSchema.extend({
  reportDefinition: z
    .record(z.unknown())
    .describe(
      'Report definition object with dateRanges, dimensions, metrics, filters, orderBys, limit, etc.'
    ),
});

const GetReportTaskSchema = z.object({
  reportTaskName: z
    .string()
    .describe('Full report task resource name, e.g. "properties/123/reportTasks/456".'),
});

const ListReportTasksSchema = PropertyIdSchema.merge(PaginationSchema);

const QueryReportTaskSchema = z.object({
  reportTaskName: z
    .string()
    .describe('Full report task resource name, e.g. "properties/123/reportTasks/456".'),
  offset: z.number().int().min(0).optional().default(0).describe('Row offset for pagination.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(250000)
    .optional()
    .default(1000)
    .describe('Maximum rows to return.'),
});

// ─── Custom dimension / metric schemas ───────────────────────────────────────

const CreateCustomDimensionSchema = PropertyIdSchema.extend({
  displayName: z.string().describe('Human-readable display name for this dimension.'),
  parameterName: z
    .string()
    .describe(
      'Immutable tag name for the dimension (event parameter, user property, or item parameter name).'
    ),
  scope: z
    .enum(['EVENT', 'USER', 'ITEM'])
    .describe('Scope of this dimension: EVENT, USER, or ITEM.'),
  description: z.string().optional().describe('Optional description.'),
  disallowAdsPersonalization: z
    .boolean()
    .optional()
    .describe('If true, marks this dimension as NPA (No Personalized Ads).'),
});

const GetCustomDimensionSchema = PropertyIdSchema.extend({
  customDimensionId: z
    .string()
    .describe('The custom dimension resource ID, e.g. "customEvent:my_param".'),
});

const ListCustomDimensionsSchema = PropertyIdSchema.merge(PaginationSchema);

const ArchiveCustomDimensionSchema = PropertyIdSchema.extend({
  customDimensionId: z
    .string()
    .describe('The custom dimension resource ID to archive, e.g. "customEvent:my_param".'),
});

const CreateCustomMetricSchema = PropertyIdSchema.extend({
  displayName: z.string().describe('Human-readable display name for this metric.'),
  parameterName: z.string().describe('Immutable event parameter name for this metric.'),
  measurementUnit: z
    .enum([
      'STANDARD',
      'CURRENCY',
      'FEET',
      'METERS',
      'KILOMETERS',
      'MILES',
      'MILLISECONDS',
      'SECONDS',
      'MINUTES',
      'HOURS',
    ])
    .describe('Unit of measurement for this metric.'),
  scope: z
    .enum(['EVENT'])
    .describe('Scope of this metric. Currently only EVENT is supported.'),
  description: z.string().optional().describe('Optional description.'),
  restrictedMetricType: z
    .array(z.string())
    .optional()
    .describe('Restricted data types, e.g. ["COST_DATA", "REVENUE_DATA"].'),
});

const ListCustomMetricsSchema = PropertyIdSchema.merge(PaginationSchema);

// ─── Expanded data set schemas ────────────────────────────────────────────────

const CreateExpandedDataSetSchema = PropertyIdSchema.extend({
  displayName: z.string().describe('Human-readable display name for this expanded data set.'),
  description: z.string().optional().describe('Optional description.'),
  dimensionNames: z.array(z.string()).optional().describe('List of dimension names to include.'),
  metricNames: z.array(z.string()).optional().describe('List of metric names to include.'),
  dimensionFilterExpression: z
    .record(z.unknown())
    .optional()
    .describe('Optional filter expression for which events are included.'),
});

const ListExpandedDataSetsSchema = PropertyIdSchema.merge(PaginationSchema);

// ─── Data stream schemas ──────────────────────────────────────────────────────

const ListDatastreamsSchema = PropertyIdSchema.merge(PaginationSchema);

const DataStreamSchema = PropertyIdSchema.extend({
  dataStreamId: z.string().describe('The data stream resource ID.'),
});

const ListEventCreateRulesSchema = DataStreamSchema.merge(PaginationSchema);
const ListMeasurementProtocolSecretsSchema = DataStreamSchema.merge(PaginationSchema);
const ListSKAdNetworkConversionValueSchemasSchema = DataStreamSchema.merge(PaginationSchema);

// ─── Key event schemas ────────────────────────────────────────────────────────

const ListKeyEventsSchema = PropertyIdSchema.merge(PaginationSchema);

const GetKeyEventSchema = PropertyIdSchema.extend({
  keyEventId: z
    .string()
    .describe('The key event ID or full resource name, e.g. "keyEvents/123".'),
});

// ─── Simple property list schemas ─────────────────────────────────────────────

const ListConversionEventsSchema = PropertyIdSchema.merge(PaginationSchema);
const ListChannelGroupsSchema = PropertyIdSchema.merge(PaginationSchema);
const ListCalculatedMetricsSchema = PropertyIdSchema.merge(PaginationSchema);
const ListAdSenseLinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListBigQueryLinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListFirebaseLinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListGoogleAdsLinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListSearchAds360LinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListDisplayVideo360AdvertiserLinksSchema = PropertyIdSchema.merge(PaginationSchema);
const ListDisplayVideo360AdvertiserLinkProposalsSchema = PropertyIdSchema.merge(PaginationSchema);
const ListSubpropertyEventFiltersSchema = PropertyIdSchema.merge(PaginationSchema);
const ListReportingDataAnnotationsSchema = PropertyIdSchema.merge(PaginationSchema);
const ListSubpropertySyncConfigsSchema = PropertyIdSchema.merge(PaginationSchema);

// ─── Rollup property schema ───────────────────────────────────────────────────

const CreateRollupPropertySchema = z.object({
  sourceProperties: z
    .array(z.string())
    .describe(
      'Resource names of properties to unite in the rollup, e.g. ["properties/123", "properties/456"].'
    ),
  displayName: z.string().optional().describe('Optional display name for the rollup property.'),
  timeZone: z.string().optional().describe('Time zone for the rollup property.'),
  currencyCode: z.string().optional().describe('Currency code for the rollup property.'),
});

// ─── Account ticket schema ────────────────────────────────────────────────────

const ProvisionAccountTicketSchema = z.object({
  account: z
    .record(z.unknown())
    .optional()
    .describe('The account to create (displayName, regionCode, etc.).'),
  redirectUri: z
    .string()
    .optional()
    .describe('Redirect URI after user accepts Terms of Service.'),
});

// ─── Measurement Protocol schemas ────────────────────────────────────────────

const MeasurementProtocolSchema = z.object({
  measurementId: z.string().describe('The GA4 Measurement ID, e.g. "G-XXXXXXXXXX".'),
  apiSecret: z
    .string()
    .describe('The Measurement Protocol API Secret from the GA4 admin interface.'),
  clientId: z
    .string()
    .optional()
    .describe('Unique client identifier. Required if userId is not provided.'),
  userId: z
    .string()
    .optional()
    .describe('Unique user identifier. Required if clientId is not provided.'),
  events: z
    .array(z.record(z.unknown()))
    .describe('Array of event objects, each with "name" and optional "params".'),
  userProperties: z.record(z.unknown()).optional().describe('Optional user properties to set.'),
  timestamp_micros: z.string().optional().describe('Optional Unix timestamp in microseconds.'),
});

const SendEventsSchema = MeasurementProtocolSchema;
const ValidateEventsSchema = MeasurementProtocolSchema;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalisePropertyId(raw: string): string {
  return raw.startsWith('properties/') ? raw : `properties/${raw}`;
}

function normaliseAccountName(raw: string): string {
  return raw.startsWith('accounts/') ? raw : `accounts/${raw}`;
}

function okResponse(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errResponse(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function paginatedGet(
  url: string,
  gaConfig: GAConfig,
  validated: { pageSize?: number; pageToken?: string }
) {
  const params: Record<string, string> = {
    pageSize: String(validated.pageSize ?? 50),
  };
  if (validated.pageToken) {
    params['pageToken'] = validated.pageToken;
  }
  return gaGet(url, gaConfig, params);
}

// ─── Tools list ──────────────────────────────────────────────────────────────

export async function getTools() {
  return [
    // === Existing tools ===
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

    // === Batch report tools ===
    {
      name: 'batch_run_reports',
      description:
        'Return multiple analytics data reports in a single batch request for one GA4 property.',
      inputSchema: zodToJsonSchema(BatchRunReportsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'batch_run_pivot_reports',
      description: 'Return multiple pivot reports in a single batch request for one GA4 property.',
      inputSchema: zodToJsonSchema(BatchRunPivotReportsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Account tools ===
    {
      name: 'get_account',
      description: 'Retrieve a single Google Analytics account by its resource name.',
      inputSchema: zodToJsonSchema(GetAccountSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_data_sharing_settings',
      description:
        'Retrieve data sharing configuration for a Google Analytics account (sharing with Google support, sales, products, benchmarking).',
      inputSchema: zodToJsonSchema(GetDataSharingSettingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_account_summaries',
      description:
        'Retrieve summaries of all Google Analytics accounts and their properties accessible to the caller.',
      inputSchema: zodToJsonSchema(ListAccountSummariesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'provision_account_ticket',
      description:
        'Request a ticket for creating a Google Analytics account. Initiates the account creation flow requiring Terms of Service acceptance.',
      inputSchema: zodToJsonSchema(ProvisionAccountTicketSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },

    // === Property tools ===
    {
      name: 'get_property',
      description:
        'Retrieve a single GA4 property by its resource name, including display name, time zone, currency, and other settings.',
      inputSchema: zodToJsonSchema(GetPropertySchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'update_property',
      description:
        'Update an existing GA4 property settings such as display name, time zone, currency, or industry category.',
      inputSchema: zodToJsonSchema(UpdatePropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'create_rollup_property',
      description:
        'Create a roll-up property that consolidates multiple GA4 properties into one aggregated view.',
      inputSchema: zodToJsonSchema(CreateRollupPropertySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_attribution_settings',
      description:
        'Retrieve attribution configuration (models, lookback windows, conversion export settings) for a GA4 property.',
      inputSchema: zodToJsonSchema(GetAttributionSettingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_data_retention_settings',
      description:
        'Retrieve data retention configuration for a GA4 property (event-level and user-level durations).',
      inputSchema: zodToJsonSchema(GetDataRetentionSettingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_google_signals_settings',
      description:
        'Retrieve Google Signals configuration settings and consent status for a GA4 property.',
      inputSchema: zodToJsonSchema(GetGoogleSignalsSettingsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_property_quotas_snapshot',
      description:
        'Retrieve all property quotas (core, funnel, realtime) for a GA4 property. Snapshot data may lag real consumption by a few minutes.',
      inputSchema: zodToJsonSchema(GetPropertyQuotasSnapshotSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Audience tools ===
    {
      name: 'list_audiences',
      description: 'List audience configurations for a Google Analytics property.',
      inputSchema: zodToJsonSchema(ListAudiencesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_audience',
      description:
        'Retrieve a single audience configuration including membership criteria and filter clauses.',
      inputSchema: zodToJsonSchema(GetAudienceSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Audience list tools (Data API v1alpha) ===
    {
      name: 'create_audience_list',
      description:
        'Create an audience list snapshot of users currently in an audience. Returns an Operation resource; query the list once the operation completes.',
      inputSchema: zodToJsonSchema(CreateAudienceListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_audience_list',
      description: 'Get configuration metadata and status about a specific audience list.',
      inputSchema: zodToJsonSchema(GetAudienceListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_audience_lists',
      description: 'List all audience lists for a GA4 property.',
      inputSchema: zodToJsonSchema(ListAudienceListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'query_audience_list',
      description: 'Query a completed audience list to retrieve user rows with pagination.',
      inputSchema: zodToJsonSchema(QueryAudienceListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'create_recurring_audience_list',
      description:
        'Create a recurring audience list that automatically generates new audience lists daily to reduce quota token consumption.',
      inputSchema: zodToJsonSchema(CreateRecurringAudienceListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_recurring_audience_list',
      description:
        'Get configuration and state metadata for a specific recurring audience list, including the most recent audience list instance.',
      inputSchema: zodToJsonSchema(GetRecurringAudienceListSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_recurring_audience_lists',
      description: 'List all recurring audience lists for a GA4 property.',
      inputSchema: zodToJsonSchema(ListRecurringAudienceListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Audience export tools (Data API v1beta) ===
    {
      name: 'create_audience_export',
      description:
        'Create an audience export snapshot at a specific point in time. Returns an operation resource; the export begins in CREATING state and must complete before querying.',
      inputSchema: zodToJsonSchema(CreateAudienceExportSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_audience_export',
      description:
        'Get configuration metadata and status about a specific audience export.',
      inputSchema: zodToJsonSchema(GetAudienceExportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_audience_exports',
      description: 'List all audience exports for a GA4 property.',
      inputSchema: zodToJsonSchema(ListAudienceExportsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'query_audience_export',
      description: 'Query a completed audience export to retrieve user rows with pagination.',
      inputSchema: zodToJsonSchema(QueryAudienceExportSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Report task tools (Data API v1alpha) ===
    {
      name: 'create_report_task',
      description:
        'Create a report task as a long-running asynchronous request. Use for large or complex reports that need to process in the background.',
      inputSchema: zodToJsonSchema(CreateReportTaskSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_report_task',
      description:
        'Get metadata about a specific report task including its processing state and report definition.',
      inputSchema: zodToJsonSchema(GetReportTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_report_tasks',
      description: 'List all report tasks for a GA4 property.',
      inputSchema: zodToJsonSchema(ListReportTasksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'query_report_task',
      description:
        'Retrieve the content of a completed report task. Only works when the task state is ACTIVE.',
      inputSchema: zodToJsonSchema(QueryReportTaskSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Custom dimension tools ===
    {
      name: 'create_custom_dimension',
      description: 'Create a CustomDimension for a Google Analytics property.',
      inputSchema: zodToJsonSchema(CreateCustomDimensionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'get_custom_dimension',
      description:
        'Retrieve a single CustomDimension including display name, scope, and parameter name.',
      inputSchema: zodToJsonSchema(GetCustomDimensionSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_custom_dimensions',
      description: 'List all CustomDimensions configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListCustomDimensionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'archive_custom_dimension',
      description:
        'Archive a CustomDimension to remove it from active use without permanently deleting it. Archived dimensions cannot be used in new reports.',
      inputSchema: zodToJsonSchema(ArchiveCustomDimensionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },

    // === Custom metric tools ===
    {
      name: 'create_custom_metric',
      description:
        'Create a custom metric in Google Analytics to track specific event parameters.',
      inputSchema: zodToJsonSchema(CreateCustomMetricSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'list_custom_metrics',
      description: 'List all custom metrics configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListCustomMetricsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Expanded data set tools ===
    {
      name: 'create_expanded_data_set',
      description:
        'Create an expanded data set combining specific dimensions and metrics for a GA4 360 property.',
      inputSchema: zodToJsonSchema(CreateExpandedDataSetSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'list_expanded_data_sets',
      description: 'List all expanded data sets configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListExpandedDataSetsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Key event tools ===
    {
      name: 'list_key_events',
      description:
        'List all key event definitions for a GA4 property. Key events are read-only via API; creation, updates, and deletion require the GA4 UI.',
      inputSchema: zodToJsonSchema(ListKeyEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'get_key_event',
      description: 'Retrieve a single key event. Key events are read-only via API.',
      inputSchema: zodToJsonSchema(GetKeyEventSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Data stream tools ===
    {
      name: 'list_datastreams',
      description: 'List data stream configurations for a Google Analytics property.',
      inputSchema: zodToJsonSchema(ListDatastreamsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_event_create_rules',
      description: 'List EventCreateRules configured on a web data stream.',
      inputSchema: zodToJsonSchema(ListEventCreateRulesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_measurement_protocol_secrets',
      description:
        'List MeasurementProtocolSecrets under a data stream for server-side event tracking.',
      inputSchema: zodToJsonSchema(ListMeasurementProtocolSecretsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_skadnetwork_conversion_value_schemas',
      description:
        'List SKAdNetworkConversionValueSchema configurations for an iOS data stream. Maximum one schema per property.',
      inputSchema: zodToJsonSchema(ListSKAdNetworkConversionValueSchemasSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Property link / integration list tools ===
    {
      name: 'list_conversion_events',
      description: 'List conversion events configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListConversionEventsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_channel_groups',
      description:
        'List ChannelGroups that categorize traffic sources in Analytics reports for a property.',
      inputSchema: zodToJsonSchema(ListChannelGroupsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_calculated_metrics',
      description: 'List all CalculatedMetrics configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListCalculatedMetricsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_adsense_links',
      description: 'List all AdSenseLinks on a GA4 property.',
      inputSchema: zodToJsonSchema(ListAdSenseLinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_bigquery_links',
      description: 'List all BigQuery Links on a GA4 property.',
      inputSchema: zodToJsonSchema(ListBigQueryLinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_firebase_links',
      description:
        'List FirebaseLinks on a GA4 property. Each property can have at most one FirebaseLink.',
      inputSchema: zodToJsonSchema(ListFirebaseLinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_google_ads_links',
      description: 'List all Google Ads Links configured for a GA4 property.',
      inputSchema: zodToJsonSchema(ListGoogleAdsLinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_search_ads360_links',
      description: 'List all SearchAds360Links on a GA4 property.',
      inputSchema: zodToJsonSchema(ListSearchAds360LinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_display_video360_advertiser_links',
      description: 'List all Display & Video 360 advertiser links on a GA4 property.',
      inputSchema: zodToJsonSchema(ListDisplayVideo360AdvertiserLinksSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_display_video360_advertiser_link_proposals',
      description: 'List Display & Video 360 advertiser link proposals on a GA4 property.',
      inputSchema: zodToJsonSchema(ListDisplayVideo360AdvertiserLinkProposalsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_subproperty_event_filters',
      description:
        'List all subproperty event filters on a GA4 property that route events to subproperties.',
      inputSchema: zodToJsonSchema(ListSubpropertyEventFiltersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_reporting_data_annotations',
      description:
        'List all Reporting Data Annotations that document important events or periods in GA4 reporting data.',
      inputSchema: zodToJsonSchema(ListReportingDataAnnotationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'list_subproperty_sync_configs',
      description:
        'List SubpropertySyncConfig resources for managing subproperty synchronization configurations.',
      inputSchema: zodToJsonSchema(ListSubpropertySyncConfigsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },

    // === Measurement Protocol tools ===
    {
      name: 'send_events',
      description:
        'Send event data to Google Analytics 4 using the Measurement Protocol for server-side tracking. Events typically appear in reports within 24–48 hours.',
      inputSchema: zodToJsonSchema(SendEventsSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'validate_events',
      description:
        'Validate Measurement Protocol events against the debug endpoint before sending to production. Use to verify event structure and parameters are correct.',
      inputSchema: zodToJsonSchema(ValidateEventsSchema),
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
      // === Existing tools ===
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

      // === Batch report tools ===
      case 'batch_run_reports': {
        const validated = BatchRunReportsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(`${GA4_DATA_BASE}/${propertyId}:batchRunReports`, gaConfig, {
          requests: validated.requests,
        });
        return okResponse(data);
      }

      case 'batch_run_pivot_reports': {
        const validated = BatchRunPivotReportsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(
          `${GA4_DATA_BASE}/${propertyId}:batchRunPivotReports`,
          gaConfig,
          { requests: validated.requests }
        );
        return okResponse(data);
      }

      // === Account tools ===
      case 'get_account': {
        const validated = GetAccountSchema.parse(args);
        const accountName = normaliseAccountName(validated.accountName);
        const data = await gaGet(`${GA4_ADMIN_BASE}/${accountName}`, gaConfig);
        return okResponse(data);
      }

      case 'get_data_sharing_settings': {
        const validated = GetDataSharingSettingsSchema.parse(args);
        const accountName = normaliseAccountName(validated.accountName);
        const data = await gaGet(
          `${GA4_ADMIN_BASE}/${accountName}/dataSharingSettings`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'list_account_summaries': {
        const validated = ListAccountSummariesSchema.parse(args);
        const data = await paginatedGet(`${GA4_ADMIN_BASE}/accountSummaries`, gaConfig, validated);
        return okResponse(data);
      }

      case 'provision_account_ticket': {
        const validated = ProvisionAccountTicketSchema.parse(args);
        const body: Record<string, unknown> = {};
        if (validated.account) body['account'] = validated.account;
        if (validated.redirectUri) body['redirectUri'] = validated.redirectUri;
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/accountTickets:provisionAccountTicket`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      // === Property tools ===
      case 'get_property': {
        const validated = GetPropertySchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(`${GA4_ADMIN_BASE}/${propertyId}`, gaConfig);
        return okResponse(data);
      }

      case 'update_property': {
        const validated = UpdatePropertySchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {};
        if (validated.displayName !== undefined) body['displayName'] = validated.displayName;
        if (validated.timeZone !== undefined) body['timeZone'] = validated.timeZone;
        if (validated.currencyCode !== undefined) body['currencyCode'] = validated.currencyCode;
        if (validated.industryCategory !== undefined)
          body['industryCategory'] = validated.industryCategory;
        const params: Record<string, string> = {};
        if (validated.updateMask) params['updateMask'] = validated.updateMask;
        const data = await gaPatch(`${GA4_ADMIN_BASE}/${propertyId}`, gaConfig, body, params);
        return okResponse(data);
      }

      case 'create_rollup_property': {
        const validated = CreateRollupPropertySchema.parse(args);
        const body: Record<string, unknown> = {
          sourceProperties: validated.sourceProperties,
        };
        if (validated.displayName) body['displayName'] = validated.displayName;
        if (validated.timeZone) body['timeZone'] = validated.timeZone;
        if (validated.currencyCode) body['currencyCode'] = validated.currencyCode;
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/properties:createRollupProperty`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      case 'get_attribution_settings': {
        const validated = GetAttributionSettingsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(
          `${GA4_ADMIN_BASE}/${propertyId}/attributionSettings`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'get_data_retention_settings': {
        const validated = GetDataRetentionSettingsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(
          `${GA4_ADMIN_BASE}/${propertyId}/dataRetentionSettings`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'get_google_signals_settings': {
        const validated = GetGoogleSignalsSettingsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(
          `${GA4_ADMIN_BASE}/${propertyId}/googleSignalsSettings`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'get_property_quotas_snapshot': {
        const validated = GetPropertyQuotasSnapshotSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaGet(
          `${GA4_ADMIN_ALPHA_BASE}/${propertyId}/quotasSnapshot`,
          gaConfig
        );
        return okResponse(data);
      }

      // === Audience tools ===
      case 'list_audiences': {
        const validated = ListAudiencesSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/audiences`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'get_audience': {
        const validated = GetAudienceSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const audienceId = validated.audienceId.startsWith('audiences/')
          ? validated.audienceId
          : `audiences/${validated.audienceId}`;
        const data = await gaGet(`${GA4_ADMIN_BASE}/${propertyId}/${audienceId}`, gaConfig);
        return okResponse(data);
      }

      // === Audience list tools (Data API v1alpha) ===
      case 'create_audience_list': {
        const validated = CreateAudienceListSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(`${GA4_DATA_ALPHA_BASE}/${propertyId}/audienceLists`, gaConfig, {
          audience: validated.audience,
          dimensions: validated.dimensions,
        });
        return okResponse(data);
      }

      case 'get_audience_list': {
        const validated = GetAudienceListSchema.parse(args);
        const data = await gaGet(
          `${GA4_DATA_ALPHA_BASE}/${validated.audienceListName}`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'list_audience_lists': {
        const validated = ListAudienceListsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_DATA_ALPHA_BASE}/${propertyId}/audienceLists`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'query_audience_list': {
        const validated = QueryAudienceListSchema.parse(args);
        const data = await gaPost(
          `${GA4_DATA_ALPHA_BASE}/${validated.audienceListName}:query`,
          gaConfig,
          { offset: validated.offset ?? 0, limit: validated.limit ?? 1000 }
        );
        return okResponse(data);
      }

      case 'create_recurring_audience_list': {
        const validated = CreateRecurringAudienceListSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(
          `${GA4_DATA_ALPHA_BASE}/${propertyId}/recurringAudienceLists`,
          gaConfig,
          { audience: validated.audience, dimensions: validated.dimensions }
        );
        return okResponse(data);
      }

      case 'get_recurring_audience_list': {
        const validated = GetRecurringAudienceListSchema.parse(args);
        const data = await gaGet(
          `${GA4_DATA_ALPHA_BASE}/${validated.recurringAudienceListName}`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'list_recurring_audience_lists': {
        const validated = ListRecurringAudienceListsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_DATA_ALPHA_BASE}/${propertyId}/recurringAudienceLists`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      // === Audience export tools (Data API v1beta) ===
      case 'create_audience_export': {
        const validated = CreateAudienceExportSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(
          `${GA4_DATA_BASE}/${propertyId}/audienceExports`,
          gaConfig,
          { audience: validated.audience, dimensions: validated.dimensions }
        );
        return okResponse(data);
      }

      case 'get_audience_export': {
        const validated = GetAudienceExportSchema.parse(args);
        const data = await gaGet(
          `${GA4_DATA_BASE}/${validated.audienceExportName}`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'list_audience_exports': {
        const validated = ListAudienceExportsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_DATA_BASE}/${propertyId}/audienceExports`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'query_audience_export': {
        const validated = QueryAudienceExportSchema.parse(args);
        const data = await gaPost(
          `${GA4_DATA_BASE}/${validated.audienceExportName}:query`,
          gaConfig,
          { offset: validated.offset ?? 0, limit: validated.limit ?? 1000 }
        );
        return okResponse(data);
      }

      // === Report task tools (Data API v1alpha) ===
      case 'create_report_task': {
        const validated = CreateReportTaskSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await gaPost(
          `${GA4_DATA_ALPHA_BASE}/${propertyId}/reportTasks`,
          gaConfig,
          { reportDefinition: validated.reportDefinition }
        );
        return okResponse(data);
      }

      case 'get_report_task': {
        const validated = GetReportTaskSchema.parse(args);
        const data = await gaGet(`${GA4_DATA_ALPHA_BASE}/${validated.reportTaskName}`, gaConfig);
        return okResponse(data);
      }

      case 'list_report_tasks': {
        const validated = ListReportTasksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_DATA_ALPHA_BASE}/${propertyId}/reportTasks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'query_report_task': {
        const validated = QueryReportTaskSchema.parse(args);
        const data = await gaPost(
          `${GA4_DATA_ALPHA_BASE}/${validated.reportTaskName}:query`,
          gaConfig,
          { offset: validated.offset ?? 0, limit: validated.limit ?? 1000 }
        );
        return okResponse(data);
      }

      // === Custom dimension tools ===
      case 'create_custom_dimension': {
        const validated = CreateCustomDimensionSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          displayName: validated.displayName,
          parameterName: validated.parameterName,
          scope: validated.scope,
        };
        if (validated.description) body['description'] = validated.description;
        if (validated.disallowAdsPersonalization !== undefined) {
          body['disallowAdsPersonalization'] = validated.disallowAdsPersonalization;
        }
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/${propertyId}/customDimensions`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      case 'get_custom_dimension': {
        const validated = GetCustomDimensionSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const customDimensionId = validated.customDimensionId.startsWith('customDimensions/')
          ? validated.customDimensionId
          : `customDimensions/${validated.customDimensionId}`;
        const data = await gaGet(
          `${GA4_ADMIN_BASE}/${propertyId}/${customDimensionId}`,
          gaConfig
        );
        return okResponse(data);
      }

      case 'list_custom_dimensions': {
        const validated = ListCustomDimensionsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/customDimensions`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'archive_custom_dimension': {
        const validated = ArchiveCustomDimensionSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const customDimensionId = validated.customDimensionId.startsWith('customDimensions/')
          ? validated.customDimensionId
          : `customDimensions/${validated.customDimensionId}`;
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/${propertyId}/${customDimensionId}:archive`,
          gaConfig,
          {}
        );
        return okResponse(data);
      }

      // === Custom metric tools ===
      case 'create_custom_metric': {
        const validated = CreateCustomMetricSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          displayName: validated.displayName,
          parameterName: validated.parameterName,
          measurementUnit: validated.measurementUnit,
          scope: validated.scope,
        };
        if (validated.description) body['description'] = validated.description;
        if (validated.restrictedMetricType?.length) {
          body['restrictedMetricType'] = validated.restrictedMetricType;
        }
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/${propertyId}/customMetrics`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      case 'list_custom_metrics': {
        const validated = ListCustomMetricsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/customMetrics`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      // === Expanded data set tools ===
      case 'create_expanded_data_set': {
        const validated = CreateExpandedDataSetSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const body: Record<string, unknown> = {
          displayName: validated.displayName,
        };
        if (validated.description) body['description'] = validated.description;
        if (validated.dimensionNames?.length) body['dimensionNames'] = validated.dimensionNames;
        if (validated.metricNames?.length) body['metricNames'] = validated.metricNames;
        if (validated.dimensionFilterExpression) {
          body['dimensionFilterExpression'] = validated.dimensionFilterExpression;
        }
        const data = await gaPost(
          `${GA4_ADMIN_BASE}/${propertyId}/expandedDataSets`,
          gaConfig,
          body
        );
        return okResponse(data);
      }

      case 'list_expanded_data_sets': {
        const validated = ListExpandedDataSetsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/expandedDataSets`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      // === Key event tools ===
      case 'list_key_events': {
        const validated = ListKeyEventsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/keyEvents`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'get_key_event': {
        const validated = GetKeyEventSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const keyEventId = validated.keyEventId.startsWith('keyEvents/')
          ? validated.keyEventId
          : `keyEvents/${validated.keyEventId}`;
        const data = await gaGet(`${GA4_ADMIN_BASE}/${propertyId}/${keyEventId}`, gaConfig);
        return okResponse(data);
      }

      // === Data stream tools ===
      case 'list_datastreams': {
        const validated = ListDatastreamsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/dataStreams`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_event_create_rules': {
        const validated = ListEventCreateRulesSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/dataStreams/${validated.dataStreamId}/eventCreateRules`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_measurement_protocol_secrets': {
        const validated = ListMeasurementProtocolSecretsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/dataStreams/${validated.dataStreamId}/measurementProtocolSecrets`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_skadnetwork_conversion_value_schemas': {
        const validated = ListSKAdNetworkConversionValueSchemasSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/dataStreams/${validated.dataStreamId}/sKAdNetworkConversionValueSchema`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      // === Simple list tools ===
      case 'list_conversion_events': {
        const validated = ListConversionEventsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/conversionEvents`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_channel_groups': {
        const validated = ListChannelGroupsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/channelGroups`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_calculated_metrics': {
        const validated = ListCalculatedMetricsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/calculatedMetrics`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_adsense_links': {
        const validated = ListAdSenseLinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/adSenseLinks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_bigquery_links': {
        const validated = ListBigQueryLinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/bigQueryLinks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_firebase_links': {
        const validated = ListFirebaseLinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/firebaseLinks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_google_ads_links': {
        const validated = ListGoogleAdsLinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/googleAdsLinks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_search_ads360_links': {
        const validated = ListSearchAds360LinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/searchAds360Links`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_display_video360_advertiser_links': {
        const validated = ListDisplayVideo360AdvertiserLinksSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/displayVideo360AdvertiserLinks`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_display_video360_advertiser_link_proposals': {
        const validated = ListDisplayVideo360AdvertiserLinkProposalsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/displayVideo360AdvertiserLinkProposals`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_subproperty_event_filters': {
        const validated = ListSubpropertyEventFiltersSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_BASE}/${propertyId}/subpropertyEventFilters`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_reporting_data_annotations': {
        const validated = ListReportingDataAnnotationsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_ALPHA_BASE}/${propertyId}/reportingDataAnnotations`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      case 'list_subproperty_sync_configs': {
        const validated = ListSubpropertySyncConfigsSchema.parse(args);
        const propertyId = normalisePropertyId(validated.propertyId);
        const data = await paginatedGet(
          `${GA4_ADMIN_ALPHA_BASE}/${propertyId}/subpropertySyncConfigs`,
          gaConfig,
          validated
        );
        return okResponse(data);
      }

      // === Measurement Protocol tools ===
      case 'send_events': {
        const validated = SendEventsSchema.parse(args);
        const body: Record<string, unknown> = { events: validated.events };
        if (validated.clientId) body['client_id'] = validated.clientId;
        if (validated.userId) body['user_id'] = validated.userId;
        if (validated.userProperties) body['user_properties'] = validated.userProperties;
        if (validated.timestamp_micros) body['timestamp_micros'] = validated.timestamp_micros;
        const res = await axios.post(
          'https://www.google-analytics.com/mp/collect',
          body,
          {
            params: {
              measurement_id: validated.measurementId,
              api_secret: validated.apiSecret,
            },
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return okResponse({ status: res.status, data: res.data });
      }

      case 'validate_events': {
        const validated = ValidateEventsSchema.parse(args);
        const body: Record<string, unknown> = { events: validated.events };
        if (validated.clientId) body['client_id'] = validated.clientId;
        if (validated.userId) body['user_id'] = validated.userId;
        if (validated.userProperties) body['user_properties'] = validated.userProperties;
        if (validated.timestamp_micros) body['timestamp_micros'] = validated.timestamp_micros;
        const res = await axios.post(
          'https://www.google-analytics.com/debug/mp/collect',
          body,
          {
            params: {
              measurement_id: validated.measurementId,
              api_secret: validated.apiSecret,
            },
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return okResponse(res.data);
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
