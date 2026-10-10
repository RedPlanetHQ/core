import axios from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const CALENDLY_API_BASE = 'https://api.calendly.com';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClient(accessToken: string): any {
  return axios.create({
    baseURL: CALENDLY_API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

function text(data: unknown) {
  return [{ type: 'text', text: JSON.stringify(data, null, 2) }];
}

// ─── Common pagination + filter schemas ─────────────────────────────────────

const PageSchema = z.object({
  count: z.number().optional().default(20).describe('Number of results per page (max 100)'),
  page_token: z.string().optional().describe('Token for the next page of results'),
});

const UriSchema = z.object({
  uri: z.string().describe('Full Calendly resource URI (e.g. https://api.calendly.com/users/xxx)'),
});

// ─── Identity + Org ──────────────────────────────────────────────────────────

const GetUserSchema = UriSchema;

const GetOrganizationSchema = UriSchema;

const ListOrgMembershipsSchema = PageSchema.extend({
  organization: z.string().describe('Organization URI'),
  email: z.string().optional().describe('Filter by member email'),
});

// ─── Event Types ─────────────────────────────────────────────────────────────

const ListEventTypesSchema = PageSchema.extend({
  user: z.string().optional().describe('User URI — required if organization is not set'),
  organization: z.string().optional().describe('Organization URI — required if user is not set'),
  active: z.boolean().optional().describe('Filter by active status'),
  sort: z
    .enum(['created_at:asc', 'created_at:desc', 'name:asc', 'name:desc'])
    .optional()
    .describe('Sort order'),
});

const GetEventTypeSchema = UriSchema;

const GetEventTypeAvailabilitySchema = z.object({
  event_type_uri: z
    .string()
    .describe('Event type URI (e.g. https://api.calendly.com/event_types/xxx)'),
  start_time: z.string().describe('Start of availability window (ISO 8601)'),
  end_time: z.string().describe('End of availability window (ISO 8601)'),
});

const ListEventTypeAvailableTimesSchema = z.object({
  event_type: z.string().describe('Event type URI'),
  start_time: z.string().describe('Start time (ISO 8601)'),
  end_time: z.string().describe('End time (ISO 8601)'),
});

// ─── Scheduled Events ────────────────────────────────────────────────────────

const ListScheduledEventsSchema = PageSchema.extend({
  user: z.string().optional().describe('User URI — use this or organization, not both'),
  organization: z
    .string()
    .optional()
    .describe('Organization URI — use this or user, not both'),
  status: z.enum(['active', 'canceled']).optional().describe('Filter by event status'),
  min_start_time: z.string().optional().describe('Earliest start time filter (ISO 8601)'),
  max_start_time: z.string().optional().describe('Latest start time filter (ISO 8601)'),
  sort: z
    .enum(['start_time:asc', 'start_time:desc'])
    .optional()
    .describe('Sort order (default: start_time:asc)'),
  invitee_email: z.string().optional().describe('Filter by invitee email'),
});

const GetScheduledEventSchema = UriSchema;

const CancelScheduledEventSchema = z.object({
  uuid: z.string().describe('UUID of the scheduled event to cancel'),
  reason: z.string().optional().describe('Cancellation reason'),
});

// ─── Invitees ─────────────────────────────────────────────────────────────────

const ListEventInviteesSchema = PageSchema.extend({
  uuid: z.string().describe('UUID of the scheduled event'),
  status: z.enum(['active', 'canceled']).optional().describe('Filter by invitee status'),
  sort: z
    .enum(['created_at:asc', 'created_at:desc'])
    .optional()
    .describe('Sort order'),
  email: z.string().optional().describe('Filter by invitee email'),
});

const GetEventInviteeSchema = z.object({
  event_uuid: z.string().describe('UUID of the scheduled event'),
  invitee_uuid: z.string().describe('UUID of the invitee'),
});

// ─── Scheduling Links ─────────────────────────────────────────────────────────

const CreateSchedulingLinkSchema = z.object({
  max_event_count: z.number().describe('Maximum number of events for this link'),
  owner: z.string().describe('Owner URI (event type URI or user URI)'),
  owner_type: z.enum(['EventType', 'User']).describe('Type of owner resource'),
});

const CreateSingleUseSchedulingLinkSchema = z.object({
  owner: z.string().describe('Event type URI this link is for'),
  owner_type: z.enum(['EventType']).optional().default('EventType'),
  max_event_count: z.number().optional().default(1).describe('Max events (default 1)'),
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

const CalendlyWebhookEvents = [
  'invitee.created',
  'invitee.canceled',
  'invitee_no_show.created',
  'invitee_no_show.deleted',
  'routing_form_submission.created',
] as const;

const CreateWebhookSchema = z.object({
  url: z.string().url().describe('HTTPS URL to receive webhook POST requests'),
  events: z
    .array(z.enum(CalendlyWebhookEvents))
    .min(1)
    .describe('List of events to subscribe to'),
  organization: z.string().describe('Organization URI'),
  user: z.string().optional().describe('User URI (for user-scoped webhooks)'),
  scope: z.enum(['user', 'organization']).describe('Scope of the webhook subscription'),
  signing_key: z
    .string()
    .optional()
    .describe('Optional signing key to verify webhook payloads'),
});

const ListWebhooksSchema = PageSchema.extend({
  organization: z.string().describe('Organization URI'),
  scope: z.enum(['user', 'organization']).describe('Webhook scope'),
  user: z.string().optional().describe('User URI (required when scope is user)'),
});

const GetWebhookSchema = z.object({
  webhook_uuid: z.string().describe('UUID of the webhook subscription'),
});

const DeleteWebhookSchema = z.object({
  webhook_uuid: z.string().describe('UUID of the webhook subscription to delete'),
});

// ─── Routing Forms ────────────────────────────────────────────────────────────

const ListRoutingFormsSchema = PageSchema.extend({
  organization: z.string().describe('Organization URI'),
  sort: z
    .enum(['created_at:asc', 'created_at:desc'])
    .optional()
    .describe('Sort order'),
});

const GetRoutingFormSchema = z.object({
  form_uuid: z.string().describe('UUID of the routing form'),
});

const GetRoutingFormSubmissionSchema = z.object({
  submission_uuid: z.string().describe('UUID of the routing form submission'),
});

// ─── Groups ───────────────────────────────────────────────────────────────────

const ListGroupsSchema = PageSchema.extend({
  organization: z.string().describe('Organization URI'),
});

const GetGroupSchema = z.object({
  group_uuid: z.string().describe('UUID of the group'),
});

// ─── Org Invitations ──────────────────────────────────────────────────────────

const ListOrgInvitationsSchema = PageSchema.extend({
  organization_uuid: z.string().describe('Organization UUID'),
  status: z
    .enum(['pending', 'accepted', 'declined', 'revoked'])
    .optional()
    .describe('Filter by invitation status'),
  email: z.string().optional().describe('Filter by invitee email'),
});

const CreateOrgInvitationSchema = z.object({
  organization_uuid: z.string().describe('Organization UUID'),
  email: z.string().email().describe('Email address of the person to invite'),
});

const RevokeOrgInvitationSchema = z.object({
  organization_uuid: z.string().describe('Organization UUID'),
  invitation_uuid: z.string().describe('UUID of the invitation to revoke'),
});

// ─── Availability Schedules ───────────────────────────────────────────────────

const ListAvailabilitySchedulesSchema = z.object({
  user: z.string().describe('User URI'),
});

const GetAvailabilityScheduleSchema = z.object({
  uuid: z.string().describe('UUID of the availability schedule'),
});

// ─── User Busy Times ──────────────────────────────────────────────────────────

const ListUserBusyTimesSchema = z.object({
  user: z.string().describe('User URI'),
  start_time: z.string().describe('Start of the time range (ISO 8601)'),
  end_time: z.string().describe('End of the time range (ISO 8601)'),
});

// ─── Tool definitions ────────────────────────────────────────────────────────

export function getTools() {
  return [
    // Identity + Org
    {
      name: 'get_current_user',
      description: 'Get the authenticated Calendly user profile',
      inputSchema: zodToJsonSchema(z.object({})),
    },
    {
      name: 'get_user',
      description: 'Get a Calendly user by URI',
      inputSchema: zodToJsonSchema(GetUserSchema),
    },
    {
      name: 'get_organization',
      description: 'Get a Calendly organization by URI',
      inputSchema: zodToJsonSchema(GetOrganizationSchema),
    },
    {
      name: 'list_organization_memberships',
      description: 'List members of a Calendly organization',
      inputSchema: zodToJsonSchema(ListOrgMembershipsSchema),
    },
    // Event Types
    {
      name: 'list_event_types',
      description:
        'List event types for a user or organization. Provide exactly one of user or organization.',
      inputSchema: zodToJsonSchema(ListEventTypesSchema),
    },
    {
      name: 'get_event_type',
      description: 'Get a specific event type by URI',
      inputSchema: zodToJsonSchema(GetEventTypeSchema),
    },
    {
      name: 'get_event_type_availability',
      description: 'Get available times for a specific event type within a date range',
      inputSchema: zodToJsonSchema(GetEventTypeAvailabilitySchema),
    },
    {
      name: 'list_event_type_available_times',
      description: 'List available meeting slots for an event type within a time range',
      inputSchema: zodToJsonSchema(ListEventTypeAvailableTimesSchema),
    },
    // Scheduled Events
    {
      name: 'list_scheduled_events',
      description:
        'List scheduled events for a user or organization. Provide exactly one of user or organization.',
      inputSchema: zodToJsonSchema(ListScheduledEventsSchema),
    },
    {
      name: 'get_scheduled_event',
      description: 'Get a specific scheduled event by URI',
      inputSchema: zodToJsonSchema(GetScheduledEventSchema),
    },
    {
      name: 'cancel_scheduled_event',
      description: 'Cancel a scheduled event by UUID',
      inputSchema: zodToJsonSchema(CancelScheduledEventSchema),
    },
    // Invitees
    {
      name: 'list_event_invitees',
      description: 'List invitees for a scheduled event',
      inputSchema: zodToJsonSchema(ListEventInviteesSchema),
    },
    {
      name: 'get_event_invitee',
      description: 'Get a specific invitee for a scheduled event',
      inputSchema: zodToJsonSchema(GetEventInviteeSchema),
    },
    // Scheduling Links
    {
      name: 'create_scheduling_link',
      description: 'Create a scheduling link for an event type or user',
      inputSchema: zodToJsonSchema(CreateSchedulingLinkSchema),
    },
    {
      name: 'create_single_use_scheduling_link',
      description: 'Create a single-use scheduling link for an event type',
      inputSchema: zodToJsonSchema(CreateSingleUseSchedulingLinkSchema),
    },
    // Webhooks
    {
      name: 'create_webhook_subscription',
      description: 'Create a webhook subscription to receive Calendly events',
      inputSchema: zodToJsonSchema(CreateWebhookSchema),
    },
    {
      name: 'list_webhook_subscriptions',
      description: 'List webhook subscriptions for an organization',
      inputSchema: zodToJsonSchema(ListWebhooksSchema),
    },
    {
      name: 'get_webhook_subscription',
      description: 'Get a specific webhook subscription by UUID',
      inputSchema: zodToJsonSchema(GetWebhookSchema),
    },
    {
      name: 'delete_webhook_subscription',
      description: 'Delete a webhook subscription by UUID',
      inputSchema: zodToJsonSchema(DeleteWebhookSchema),
    },
    // Routing Forms
    {
      name: 'list_routing_forms',
      description: 'List routing forms for an organization',
      inputSchema: zodToJsonSchema(ListRoutingFormsSchema),
    },
    {
      name: 'get_routing_form',
      description: 'Get a specific routing form by UUID',
      inputSchema: zodToJsonSchema(GetRoutingFormSchema),
    },
    {
      name: 'get_routing_form_submission',
      description: 'Get a specific routing form submission by UUID',
      inputSchema: zodToJsonSchema(GetRoutingFormSubmissionSchema),
    },
    // Groups
    {
      name: 'list_groups',
      description: 'List groups in a Calendly organization',
      inputSchema: zodToJsonSchema(ListGroupsSchema),
    },
    {
      name: 'get_group',
      description: 'Get a specific group by UUID',
      inputSchema: zodToJsonSchema(GetGroupSchema),
    },
    // Org Invitations
    {
      name: 'list_organization_invitations',
      description: 'List invitations sent for a Calendly organization',
      inputSchema: zodToJsonSchema(ListOrgInvitationsSchema),
    },
    {
      name: 'create_organization_invitation',
      description: 'Invite someone to join a Calendly organization by email',
      inputSchema: zodToJsonSchema(CreateOrgInvitationSchema),
    },
    {
      name: 'revoke_organization_invitation',
      description: 'Revoke a pending organization invitation',
      inputSchema: zodToJsonSchema(RevokeOrgInvitationSchema),
    },
    // Availability
    {
      name: 'list_user_availability_schedules',
      description: "List a user's availability schedules",
      inputSchema: zodToJsonSchema(ListAvailabilitySchedulesSchema),
    },
    {
      name: 'get_user_availability_schedule',
      description: 'Get a specific availability schedule by UUID',
      inputSchema: zodToJsonSchema(GetAvailabilityScheduleSchema),
    },
    {
      name: 'list_user_busy_times',
      description: "List a user's busy time blocks within a given time range",
      inputSchema: zodToJsonSchema(ListUserBusyTimesSchema),
    },
  ];
}

// ─── Tool execution ──────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>,
) {
  const accessToken = config?.access_token as string;
  if (!accessToken) throw new Error('No access_token in config');

  const client = createClient(accessToken);

  switch (name) {
    // ── Identity + Org ───────────────────────────────────────────────────────
    case 'get_current_user': {
      const res = await client.get('/users/me');
      return text(res.data.resource);
    }

    case 'get_user': {
      const { uri } = GetUserSchema.parse(args);
      const uuid = uri.split('/').pop();
      const res = await client.get(`/users/${uuid}`);
      return text(res.data.resource);
    }

    case 'get_organization': {
      const { uri } = GetOrganizationSchema.parse(args);
      const uuid = uri.split('/').pop();
      const res = await client.get(`/organizations/${uuid}`);
      return text(res.data.resource);
    }

    case 'list_organization_memberships': {
      const { organization, email, count, page_token } =
        ListOrgMembershipsSchema.parse(args);
      const params: Record<string, unknown> = { organization, count };
      if (email) params.email = email;
      if (page_token) params.page_token = page_token;
      const res = await client.get('/organization_memberships', { params });
      return text(res.data);
    }

    // ── Event Types ──────────────────────────────────────────────────────────
    case 'list_event_types': {
      const { user, organization, active, sort, count, page_token } =
        ListEventTypesSchema.parse(args);
      const params: Record<string, unknown> = { count };
      if (user) params.user = user;
      if (organization) params.organization = organization;
      if (active !== undefined) params.active = active;
      if (sort) params.sort = sort;
      if (page_token) params.page_token = page_token;
      const res = await client.get('/event_types', { params });
      return text(res.data);
    }

    case 'get_event_type': {
      const { uri } = GetEventTypeSchema.parse(args);
      const uuid = uri.split('/').pop();
      const res = await client.get(`/event_types/${uuid}`);
      return text(res.data.resource);
    }

    case 'get_event_type_availability': {
      const { event_type_uri, start_time, end_time } =
        GetEventTypeAvailabilitySchema.parse(args);
      const uuid = event_type_uri.split('/').pop();
      const res = await client.get(`/event_type_available_times`, {
        params: { event_type: `https://api.calendly.com/event_types/${uuid}`, start_time, end_time },
      });
      return text(res.data);
    }

    case 'list_event_type_available_times': {
      const { event_type, start_time, end_time } =
        ListEventTypeAvailableTimesSchema.parse(args);
      const res = await client.get('/event_type_available_times', {
        params: { event_type, start_time, end_time },
      });
      return text(res.data);
    }

    // ── Scheduled Events ─────────────────────────────────────────────────────
    case 'list_scheduled_events': {
      const {
        user,
        organization,
        status,
        min_start_time,
        max_start_time,
        sort,
        invitee_email,
        count,
        page_token,
      } = ListScheduledEventsSchema.parse(args);
      const params: Record<string, unknown> = { count };
      if (user) params.user = user;
      if (organization) params.organization = organization;
      if (status) params.status = status;
      if (min_start_time) params.min_start_time = min_start_time;
      if (max_start_time) params.max_start_time = max_start_time;
      if (sort) params.sort = sort;
      if (invitee_email) params.invitee_email = invitee_email;
      if (page_token) params.page_token = page_token;
      const res = await client.get('/scheduled_events', { params });
      return text(res.data);
    }

    case 'get_scheduled_event': {
      const { uri } = GetScheduledEventSchema.parse(args);
      const uuid = uri.split('/').pop();
      const res = await client.get(`/scheduled_events/${uuid}`);
      return text(res.data.resource);
    }

    case 'cancel_scheduled_event': {
      const { uuid, reason } = CancelScheduledEventSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (reason) body.reason = reason;
      const res = await client.post(`/scheduled_events/${uuid}/cancellation`, body);
      return text(res.data);
    }

    // ── Invitees ─────────────────────────────────────────────────────────────
    case 'list_event_invitees': {
      const { uuid, status, sort, email, count, page_token } =
        ListEventInviteesSchema.parse(args);
      const params: Record<string, unknown> = { count };
      if (status) params.status = status;
      if (sort) params.sort = sort;
      if (email) params.email = email;
      if (page_token) params.page_token = page_token;
      const res = await client.get(`/scheduled_events/${uuid}/invitees`, { params });
      return text(res.data);
    }

    case 'get_event_invitee': {
      const { event_uuid, invitee_uuid } = GetEventInviteeSchema.parse(args);
      const res = await client.get(
        `/scheduled_events/${event_uuid}/invitees/${invitee_uuid}`,
      );
      return text(res.data.resource);
    }

    // ── Scheduling Links ─────────────────────────────────────────────────────
    case 'create_scheduling_link': {
      const { max_event_count, owner, owner_type } =
        CreateSchedulingLinkSchema.parse(args);
      const res = await client.post('/scheduling_links', {
        max_event_count,
        owner,
        owner_type,
      });
      return text(res.data.resource);
    }

    case 'create_single_use_scheduling_link': {
      const { owner, owner_type, max_event_count } =
        CreateSingleUseSchedulingLinkSchema.parse(args);
      const res = await client.post('/scheduling_links', {
        max_event_count,
        owner,
        owner_type,
      });
      return text(res.data.resource);
    }

    // ── Webhooks ─────────────────────────────────────────────────────────────
    case 'create_webhook_subscription': {
      const { url, events, organization, user, scope, signing_key } =
        CreateWebhookSchema.parse(args);
      const body: Record<string, unknown> = { url, events, organization, scope };
      if (user) body.user = user;
      if (signing_key) body.signing_key = signing_key;
      const res = await client.post('/webhook_subscriptions', body);
      return text(res.data.resource);
    }

    case 'list_webhook_subscriptions': {
      const { organization, scope, user, count, page_token } =
        ListWebhooksSchema.parse(args);
      const params: Record<string, unknown> = { organization, scope, count };
      if (user) params.user = user;
      if (page_token) params.page_token = page_token;
      const res = await client.get('/webhook_subscriptions', { params });
      return text(res.data);
    }

    case 'get_webhook_subscription': {
      const { webhook_uuid } = GetWebhookSchema.parse(args);
      const res = await client.get(`/webhook_subscriptions/${webhook_uuid}`);
      return text(res.data.resource);
    }

    case 'delete_webhook_subscription': {
      const { webhook_uuid } = DeleteWebhookSchema.parse(args);
      await client.delete(`/webhook_subscriptions/${webhook_uuid}`);
      return text({ deleted: true, webhook_uuid });
    }

    // ── Routing Forms ────────────────────────────────────────────────────────
    case 'list_routing_forms': {
      const { organization, sort, count, page_token } =
        ListRoutingFormsSchema.parse(args);
      const params: Record<string, unknown> = { organization, count };
      if (sort) params.sort = sort;
      if (page_token) params.page_token = page_token;
      const res = await client.get('/routing_forms', { params });
      return text(res.data);
    }

    case 'get_routing_form': {
      const { form_uuid } = GetRoutingFormSchema.parse(args);
      const res = await client.get(`/routing_forms/${form_uuid}`);
      return text(res.data.resource);
    }

    case 'get_routing_form_submission': {
      const { submission_uuid } = GetRoutingFormSubmissionSchema.parse(args);
      const res = await client.get(`/routing_form_submissions/${submission_uuid}`);
      return text(res.data.resource);
    }

    // ── Groups ───────────────────────────────────────────────────────────────
    case 'list_groups': {
      const { organization, count, page_token } = ListGroupsSchema.parse(args);
      const params: Record<string, unknown> = { organization, count };
      if (page_token) params.page_token = page_token;
      const res = await client.get('/groups', { params });
      return text(res.data);
    }

    case 'get_group': {
      const { group_uuid } = GetGroupSchema.parse(args);
      const res = await client.get(`/groups/${group_uuid}`);
      return text(res.data.resource);
    }

    // ── Org Invitations ──────────────────────────────────────────────────────
    case 'list_organization_invitations': {
      const { organization_uuid, status, email, count, page_token } =
        ListOrgInvitationsSchema.parse(args);
      const params: Record<string, unknown> = { count };
      if (status) params.status = status;
      if (email) params.email = email;
      if (page_token) params.page_token = page_token;
      const res = await client.get(
        `/organizations/${organization_uuid}/invitations`,
        { params },
      );
      return text(res.data);
    }

    case 'create_organization_invitation': {
      const { organization_uuid, email } = CreateOrgInvitationSchema.parse(args);
      const res = await client.post(`/organizations/${organization_uuid}/invitations`, {
        email,
      });
      return text(res.data.resource);
    }

    case 'revoke_organization_invitation': {
      const { organization_uuid, invitation_uuid } =
        RevokeOrgInvitationSchema.parse(args);
      await client.delete(
        `/organizations/${organization_uuid}/invitations/${invitation_uuid}`,
      );
      return text({ revoked: true, invitation_uuid });
    }

    // ── Availability ─────────────────────────────────────────────────────────
    case 'list_user_availability_schedules': {
      const { user } = ListAvailabilitySchedulesSchema.parse(args);
      const res = await client.get('/user_availability_schedules', {
        params: { user },
      });
      return text(res.data);
    }

    case 'get_user_availability_schedule': {
      const { uuid } = GetAvailabilityScheduleSchema.parse(args);
      const res = await client.get(`/user_availability_schedules/${uuid}`);
      return text(res.data.resource);
    }

    case 'list_user_busy_times': {
      const { user, start_time, end_time } = ListUserBusyTimesSchema.parse(args);
      const res = await client.get('/user_busy_times', {
        params: { user, start_time, end_time },
      });
      return text(res.data);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
