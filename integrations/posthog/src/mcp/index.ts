import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getPostHogClient, PostHogConfig } from '../utils';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ListEventsSchema = z.object({
  limit: z.number().optional().default(50).describe('Maximum number of events to return (default: 50)'),
  event: z.string().optional().describe('Filter by event name (e.g. "$pageview", "button_clicked")'),
  after: z.string().optional().describe('Return events after this ISO 8601 timestamp'),
  before: z.string().optional().describe('Return events before this ISO 8601 timestamp'),
  distinct_id: z.string().optional().describe('Filter events for a specific user distinct_id'),
});

const GetEventSchema = z.object({
  event_id: z.string().describe('ID of the event to retrieve'),
});

const ListEventDefinitionsSchema = z.object({
  search: z.string().optional().describe('Search event definitions by name'),
  limit: z.number().optional().default(50).describe('Maximum results to return'),
});

const ListFeatureFlagsSchema = z.object({
  active_only: z.boolean().optional().describe('Return only active feature flags'),
  search: z.string().optional().describe('Search flags by name or key'),
});

const GetFeatureFlagSchema = z.object({
  flag_id: z.number().describe('ID of the feature flag'),
});

const EvaluateFeatureFlagSchema = z.object({
  flag_key: z.string().describe('Key of the feature flag to evaluate'),
  distinct_id: z.string().describe('Distinct ID of the user to evaluate the flag for'),
  groups: z
    .record(z.any())
    .optional()
    .describe('Group membership for group-based flags (e.g. {"organization": "org-123"})'),
});

const ListInsightsSchema = z.object({
  limit: z.number().optional().default(20).describe('Maximum results to return'),
  search: z.string().optional().describe('Search insights by name'),
});

const GetInsightSchema = z.object({
  insight_id: z.number().describe('Numeric ID of the insight'),
});

const ListPersonsSchema = z.object({
  search: z.string().optional().describe('Search persons by name, email, or distinct_id'),
  limit: z.number().optional().default(20).describe('Maximum results to return'),
});

const GetPersonSchema = z.object({
  person_id: z.number().describe('Numeric ID of the person'),
});

const ListDashboardsSchema = z.object({
  limit: z.number().optional().default(20).describe('Maximum results to return'),
});

const ListAnnotationsSchema = z.object({
  limit: z.number().optional().default(50).describe('Maximum results to return'),
  scope: z
    .enum(['dashboard', 'project'])
    .optional()
    .describe('Filter annotations by scope'),
});

const CreateAnnotationSchema = z.object({
  content: z.string().describe('Text content of the annotation'),
  date_marker: z
    .string()
    .describe('ISO 8601 date/time for the annotation marker (e.g. "2025-01-15T10:00:00Z")'),
  scope: z
    .enum(['dashboard', 'project'])
    .optional()
    .default('project')
    .describe('Scope of the annotation'),
});

const ListSurveysSchema = z.object({
  limit: z.number().optional().default(20).describe('Maximum results to return'),
});

const CaptureEventSchema = z.object({
  distinct_id: z.string().describe('Distinct ID of the user or actor'),
  event: z.string().describe('Name of the event to capture'),
  properties: z
    .record(z.any())
    .optional()
    .describe('Additional properties to attach to the event'),
  timestamp: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp of the event (defaults to now)'),
});

// Pre-convert schemas to avoid deep TS instantiation
const listEventsSchemaJson = zodToJsonSchema(ListEventsSchema) as any;
const getEventSchemaJson = zodToJsonSchema(GetEventSchema) as any;
const listEventDefsSchemaJson = zodToJsonSchema(ListEventDefinitionsSchema) as any;
const listFeatureFlagsSchemaJson = zodToJsonSchema(ListFeatureFlagsSchema) as any;
const getFeatureFlagSchemaJson = zodToJsonSchema(GetFeatureFlagSchema) as any;
const evaluateFeatureFlagSchemaJson = zodToJsonSchema(EvaluateFeatureFlagSchema) as any;
const listInsightsSchemaJson = zodToJsonSchema(ListInsightsSchema) as any;
const getInsightSchemaJson = zodToJsonSchema(GetInsightSchema) as any;
const listPersonsSchemaJson = zodToJsonSchema(ListPersonsSchema) as any;
const getPersonSchemaJson = zodToJsonSchema(GetPersonSchema) as any;
const listDashboardsSchemaJson = zodToJsonSchema(ListDashboardsSchema) as any;
const listAnnotationsSchemaJson = zodToJsonSchema(ListAnnotationsSchema) as any;
const createAnnotationSchemaJson = zodToJsonSchema(CreateAnnotationSchema) as any;
const listSurveysSchemaJson = zodToJsonSchema(ListSurveysSchema) as any;
const captureEventSchemaJson = zodToJsonSchema(CaptureEventSchema) as any;

// ─── Tool list ────────────────────────────────────────────────────────────────

export function getTools() {
  return [
    {
      name: 'posthog_list_events',
      description:
        'List recent captured events in the PostHog project. Filter by event name, date range, or user.',
      inputSchema: listEventsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_get_event',
      description: 'Get details of a specific captured event by its ID.',
      inputSchema: getEventSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_event_definitions',
      description:
        'List event definitions (the catalogue of all events ever captured in the project).',
      inputSchema: listEventDefsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_feature_flags',
      description:
        'List feature flags in the PostHog project, optionally filtered to active flags only.',
      inputSchema: listFeatureFlagsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_get_feature_flag',
      description: 'Get details of a specific feature flag by its numeric ID.',
      inputSchema: getFeatureFlagSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_evaluate_feature_flag',
      description:
        'Evaluate a feature flag for a specific user (distinct_id) to determine if it is enabled and what variant they receive.',
      inputSchema: evaluateFeatureFlagSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_insights',
      description: 'List saved insights (charts, funnels, retention, etc.) in the project.',
      inputSchema: listInsightsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_get_insight',
      description: 'Get details of a specific saved insight by its numeric ID.',
      inputSchema: getInsightSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_persons',
      description: 'List persons (identified users) in the PostHog project.',
      inputSchema: listPersonsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_get_person',
      description: 'Get profile details of a specific person by their numeric ID.',
      inputSchema: getPersonSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_dashboards',
      description: 'List dashboards in the PostHog project.',
      inputSchema: listDashboardsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_list_annotations',
      description: 'List annotations added to the project or dashboards.',
      inputSchema: listAnnotationsSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_create_annotation',
      description:
        'Create a new annotation on the project timeline to mark a deployment, experiment, or notable event.',
      inputSchema: createAnnotationSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'posthog_list_surveys',
      description: 'List surveys configured in the PostHog project.',
      inputSchema: listSurveysSchemaJson,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'posthog_capture_event',
      description:
        'Capture a custom event into PostHog on behalf of a user. Useful for server-side event tracking.',
      inputSchema: captureEventSchemaJson,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
  ];
}

// ─── Tool runner ─────────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  config: PostHogConfig
): Promise<any> {
  const client = getPostHogClient(config.api_key, config.host);
  const projectId = config.project_id;

  const ok = (data: any) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });

  const err = (msg: string) => ({
    content: [{ type: 'text', text: `Error: ${msg}` }],
    isError: true,
  });

  try {
    switch (name) {
      case 'posthog_list_events': {
        const { limit, event, after, before, distinct_id } = ListEventsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (event) params.event = event;
        if (after) params.after = after;
        if (before) params.before = before;
        if (distinct_id) params.distinct_id = distinct_id;

        const response = await client.get(`/api/projects/${projectId}/events/`, { params });
        return ok(response.data);
      }

      case 'posthog_get_event': {
        const { event_id } = GetEventSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/events/${event_id}/`);
        return ok(response.data);
      }

      case 'posthog_list_event_definitions': {
        const { search, limit } = ListEventDefinitionsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (search) params.search = search;

        const response = await client.get(`/api/projects/${projectId}/event_definitions/`, { params });
        return ok(response.data);
      }

      case 'posthog_list_feature_flags': {
        const { active_only, search } = ListFeatureFlagsSchema.parse(args);
        const params: Record<string, any> = {};
        if (active_only) params.active = true;
        if (search) params.search = search;

        const response = await client.get(`/api/projects/${projectId}/feature_flags/`, { params });
        return ok(response.data);
      }

      case 'posthog_get_feature_flag': {
        const { flag_id } = GetFeatureFlagSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/feature_flags/${flag_id}/`);
        return ok(response.data);
      }

      case 'posthog_evaluate_feature_flag': {
        const { flag_key, distinct_id, groups } = EvaluateFeatureFlagSchema.parse(args);
        const body: Record<string, any> = {
          distinct_id,
          token: config.api_key,
        };
        if (groups) body.groups = groups;

        const response = await client.post('/decide/?v=3', body);
        const flagValue = response.data?.featureFlags?.[flag_key];
        return ok({
          flag_key,
          distinct_id,
          value: flagValue ?? false,
          all_flags: response.data?.featureFlags ?? {},
        });
      }

      case 'posthog_list_insights': {
        const { limit, search } = ListInsightsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (search) params.search = search;

        const response = await client.get(`/api/projects/${projectId}/insights/`, { params });
        return ok(response.data);
      }

      case 'posthog_get_insight': {
        const { insight_id } = GetInsightSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/insights/${insight_id}/`);
        return ok(response.data);
      }

      case 'posthog_list_persons': {
        const { search, limit } = ListPersonsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (search) params.search = search;

        const response = await client.get(`/api/projects/${projectId}/persons/`, { params });
        return ok(response.data);
      }

      case 'posthog_get_person': {
        const { person_id } = GetPersonSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/persons/${person_id}/`);
        return ok(response.data);
      }

      case 'posthog_list_dashboards': {
        const { limit } = ListDashboardsSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/dashboards/`, {
          params: { limit },
        });
        return ok(response.data);
      }

      case 'posthog_list_annotations': {
        const { limit, scope } = ListAnnotationsSchema.parse(args);
        const params: Record<string, any> = { limit };
        if (scope) params.scope = scope;

        const response = await client.get(`/api/projects/${projectId}/annotations/`, { params });
        return ok(response.data);
      }

      case 'posthog_create_annotation': {
        const { content, date_marker, scope } = CreateAnnotationSchema.parse(args);
        const response = await client.post(`/api/projects/${projectId}/annotations/`, {
          content,
          date_marker,
          scope,
        });
        return ok(response.data);
      }

      case 'posthog_list_surveys': {
        const { limit } = ListSurveysSchema.parse(args);
        const response = await client.get(`/api/projects/${projectId}/surveys/`, {
          params: { limit },
        });
        return ok(response.data);
      }

      case 'posthog_capture_event': {
        const { distinct_id, event, properties, timestamp } = CaptureEventSchema.parse(args);
        const payload: Record<string, any> = {
          api_key: config.api_key,
          distinct_id,
          event,
          properties: properties ?? {},
        };
        if (timestamp) payload.timestamp = timestamp;

        // Capture endpoint uses the project API key (public key), not the personal key.
        // We post to the capture endpoint directly.
        const captureClient = getPostHogClient(config.api_key, config.host);
        await captureClient.post('/capture/', payload);

        return ok({ success: true, event, distinct_id });
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message;
    return err(message);
  }
}
