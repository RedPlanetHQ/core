/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetBoardsSchema = z.object({
  filter: z
    .enum(['open', 'closed', 'all'])
    .optional()
    .default('open')
    .describe('Filter boards by status: open, closed, or all (default: open)'),
  fields: z
    .string()
    .optional()
    .describe('Comma-separated list of board fields to return (e.g. "id,name,url")'),
});

const GetBoardSchema = z.object({
  board_id: z.string().describe('The ID of the board to retrieve'),
  fields: z
    .string()
    .optional()
    .describe('Comma-separated list of fields to return (e.g. "id,name,desc,url")'),
});

const CreateBoardSchema = z.object({
  name: z.string().describe('The name for the new board'),
  desc: z.string().optional().describe('A description for the board'),
  idOrganization: z
    .string()
    .optional()
    .describe('The ID of the organization (workspace) to create the board in'),
  defaultLists: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to create the default To Do, Doing, Done lists (default: true)'),
  prefs_permissionLevel: z
    .enum(['private', 'public', 'org', 'enterprise'])
    .optional()
    .describe('Board visibility level: private, public, org, or enterprise'),
  prefs_background: z
    .string()
    .optional()
    .describe('Background color or image ID for the board (e.g. "blue", "orange")'),
});

const UpdateBoardSchema = z.object({
  board_id: z.string().describe('The ID of the board to update'),
  name: z.string().optional().describe('New name for the board'),
  desc: z.string().optional().describe('New description for the board'),
  closed: z.boolean().optional().describe('Set to true to archive the board, false to unarchive'),
  subscribed: z
    .boolean()
    .optional()
    .describe('Set to true to subscribe to board notifications'),
  prefs_permissionLevel: z
    .enum(['private', 'public', 'org', 'enterprise'])
    .optional()
    .describe('Board visibility level: private, public, org, or enterprise'),
  prefs_background: z
    .string()
    .optional()
    .describe('Background color or image ID for the board'),
});

const DeleteBoardSchema = z.object({
  board_id: z.string().describe('The ID of the board to permanently delete'),
});

const GetBoardActionsSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  filter: z
    .string()
    .optional()
    .describe(
      'Comma-separated action types to filter by (e.g. "commentCard,createCard"). Omit for all types.',
    ),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Maximum number of actions to return (default: 50, max: 1000)'),
  since: z
    .string()
    .optional()
    .describe('Return actions since this date (ISO 8601 or action ID)'),
  before: z
    .string()
    .optional()
    .describe('Return actions before this date (ISO 8601 or action ID)'),
});

const GetBoardCardsSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  filter: z
    .enum(['all', 'open', 'closed', 'visible'])
    .optional()
    .default('open')
    .describe('Filter cards by status: all, open, closed, or visible (default: open)'),
});

const GetBoardChecklistsSchema = z.object({
  board_id: z.string().describe('The ID of the board to get checklists from'),
});

const GetBoardCustomFieldsSchema = z.object({
  board_id: z.string().describe('The ID of the board to get custom fields from'),
});

const GetBoardLabelsSchema = z.object({
  board_id: z.string().describe('The ID of the board to get labels from'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Maximum number of labels to return (default: 50)'),
});

const CreateBoardLabelSchema = z.object({
  board_id: z.string().describe('The ID of the board to create the label on'),
  name: z.string().describe('The name for the new label'),
  color: z
    .enum(['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime'])
    .describe('The color for the label'),
});

const GetBoardListsSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  filter: z
    .enum(['all', 'open', 'closed'])
    .optional()
    .default('open')
    .describe('Filter lists by status: all, open, or closed (default: open)'),
});

const CreateBoardListSchema = z.object({
  board_id: z.string().describe('The ID of the board to create the list on'),
  name: z.string().describe('The name for the new list'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('Position for the new list: "top", "bottom", or a positive number'),
});

const GetBoardMembersSchema = z.object({
  board_id: z.string().describe('The ID of the board to get members from'),
});

const AddBoardMemberSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  member_id: z.string().describe('The ID of the member to add to the board'),
  type: z
    .enum(['normal', 'admin', 'observer'])
    .optional()
    .default('normal')
    .describe('The membership type for the member: normal, admin, or observer (default: normal)'),
});

const InviteBoardMemberByEmailSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  email: z.string().describe('The email address of the person to invite'),
  type: z
    .enum(['normal', 'admin', 'observer'])
    .optional()
    .default('normal')
    .describe('The membership type: normal, admin, or observer (default: normal)'),
  fullName: z.string().optional().describe('The full name of the person being invited'),
});

const RemoveBoardMemberSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  member_id: z.string().describe('The ID of the member to remove from the board'),
});

const GetBoardMembershipsSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  filter: z
    .enum(['all', 'active', 'admin', 'deactivated', 'me', 'none', 'normal', 'observer'])
    .optional()
    .default('all')
    .describe(
      'Filter memberships by type: all, active, admin, deactivated, me, none, normal, or observer (default: all)',
    ),
});

const UpdateBoardMembershipSchema = z.object({
  board_id: z.string().describe('The ID of the board'),
  membership_id: z.string().describe('The ID of the membership to update'),
  type: z
    .enum(['normal', 'admin', 'observer'])
    .describe('The new membership type: normal, admin, or observer'),
});

const MarkBoardAsViewedSchema = z.object({
  board_id: z.string().describe('The ID of the board to mark as viewed'),
});

const GenerateBoardCalendarKeySchema = z.object({
  board_id: z.string().describe('The ID of the board to generate a calendar key for'),
});

const GenerateBoardEmailKeySchema = z.object({
  board_id: z.string().describe('The ID of the board to generate an email key for'),
});

const GetBoardPluginsSchema = z.object({
  board_id: z.string().describe('The ID of the board to get enabled power-ups for'),
});

const GetAvailableBoardPluginsSchema = z.object({
  board_id: z.string().describe('The ID of the board to get available power-ups for'),
});

const EnableBoardPluginSchema = z.object({
  board_id: z.string().describe('The ID of the board to enable the power-up on'),
  idPlugin: z.string().describe('The ID of the plugin/power-up to enable'),
});

const DisableBoardPluginSchema = z.object({
  board_id: z.string().describe('The ID of the board to disable the power-up on'),
  idPlugin: z.string().describe('The ID of the plugin/power-up to disable'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_boards',
      description:
        'List all Trello boards the authenticated user is a member of, with optional filtering by status.',
      inputSchema: zodToJsonSchema(GetBoardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_board',
      description:
        'Get full details of a specific Trello board including its preferences and label names.',
      inputSchema: zodToJsonSchema(GetBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_board',
      description: 'Create a new Trello board with optional organization, visibility, and background settings.',
      inputSchema: zodToJsonSchema(CreateBoardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_board',
      description:
        'Update properties of an existing Trello board such as name, description, visibility, or archived status.',
      inputSchema: zodToJsonSchema(UpdateBoardSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_board',
      description:
        'Permanently delete a Trello board and all its contents. This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteBoardSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_board_actions',
      description:
        'Get the activity history (actions) for a Trello board, with optional filtering by type and date range.',
      inputSchema: zodToJsonSchema(GetBoardActionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_board_cards',
      description: 'Get all cards on a Trello board, optionally filtered by open, closed, or visible status.',
      inputSchema: zodToJsonSchema(GetBoardCardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_board_checklists',
      description: 'Get all checklists on a Trello board.',
      inputSchema: zodToJsonSchema(GetBoardChecklistsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_board_custom_fields',
      description: 'Get all custom fields defined on a Trello board.',
      inputSchema: zodToJsonSchema(GetBoardCustomFieldsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_board_labels',
      description: 'Get all labels defined on a Trello board.',
      inputSchema: zodToJsonSchema(GetBoardLabelsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_board_label',
      description: 'Create a new label on a Trello board with a specified name and color.',
      inputSchema: zodToJsonSchema(CreateBoardLabelSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_board_lists',
      description: 'Get all lists on a Trello board, optionally filtered by open or closed status.',
      inputSchema: zodToJsonSchema(GetBoardListsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_board_list',
      description: 'Create a new list on a Trello board at a specified position.',
      inputSchema: zodToJsonSchema(CreateBoardListSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_board_members',
      description: 'Get all members of a Trello board with their roles.',
      inputSchema: zodToJsonSchema(GetBoardMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_board_member',
      description: 'Add an existing Trello member to a board by their member ID.',
      inputSchema: zodToJsonSchema(AddBoardMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_invite_board_member_by_email',
      description: 'Invite a person to a Trello board by email address.',
      inputSchema: zodToJsonSchema(InviteBoardMemberByEmailSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_remove_board_member',
      description: 'Remove a member from a Trello board.',
      inputSchema: zodToJsonSchema(RemoveBoardMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_board_memberships',
      description: 'Get all memberships on a Trello board with filtering options.',
      inputSchema: zodToJsonSchema(GetBoardMembershipsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_board_membership',
      description: "Update a member's role (membership type) on a Trello board.",
      inputSchema: zodToJsonSchema(UpdateBoardMembershipSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_mark_board_as_viewed',
      description: 'Mark a Trello board as recently viewed for the authenticated user.',
      inputSchema: zodToJsonSchema(MarkBoardAsViewedSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_generate_board_calendar_key',
      description:
        'Generate a new calendar key for a Trello board to enable iCal feed access. Replaces any existing key.',
      inputSchema: zodToJsonSchema(GenerateBoardCalendarKeySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_generate_board_email_key',
      description:
        'Generate a new email key for a Trello board to enable adding cards via email. Replaces any existing key.',
      inputSchema: zodToJsonSchema(GenerateBoardEmailKeySchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_get_board_plugins',
      description: 'Get all power-ups (plugins) currently enabled on a Trello board.',
      inputSchema: zodToJsonSchema(GetBoardPluginsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_available_board_plugins',
      description: 'Get all power-ups (plugins) available to be enabled on a Trello board.',
      inputSchema: zodToJsonSchema(GetAvailableBoardPluginsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_enable_board_plugin',
      description: 'Enable a power-up (plugin) on a Trello board by its plugin ID.',
      inputSchema: zodToJsonSchema(EnableBoardPluginSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_disable_board_plugin',
      description: 'Disable an enabled power-up (plugin) on a Trello board.',
      inputSchema: zodToJsonSchema(DisableBoardPluginSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance,
): Promise<any> {
  try {
    switch (name) {
      case 'trello_get_boards': {
        const { filter, fields } = GetBoardsSchema.parse(args);
        const params: Record<string, any> = { filter };
        if (fields) params.fields = fields;

        const response = await client.get('/members/me/boards', { params });
        const boards: any[] = response.data || [];

        if (boards.length === 0) {
          return { content: [{ type: 'text', text: 'No boards found.' }] };
        }

        const list = boards
          .map(
            (b: any) =>
              `ID: ${b.id}\nName: ${b.name}\nDescription: ${b.desc || 'N/A'}\nURL: ${b.url}\nClosed: ${b.closed}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${boards.length} board(s):\n\n${list}` }],
        };
      }

      case 'trello_get_board': {
        const { board_id, fields } = GetBoardSchema.parse(args);
        const params: Record<string, any> = {};
        if (fields) params.fields = fields;

        const response = await client.get(`/boards/${board_id}`, { params });
        const b = response.data;

        const labelNames = b.labelNames
          ? Object.entries(b.labelNames)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : 'N/A';

        return {
          content: [
            {
              type: 'text',
              text: `Board: ${b.name}\nID: ${b.id}\nDescription: ${b.desc || 'N/A'}\nURL: ${b.url}\nClosed: ${b.closed}\nPermission Level: ${b.prefs?.permissionLevel || 'N/A'}\nBackground: ${b.prefs?.background || 'N/A'}\nLabel Names: ${labelNames}`,
            },
          ],
        };
      }

      case 'trello_create_board': {
        const { name, desc, idOrganization, defaultLists, prefs_permissionLevel, prefs_background } =
          CreateBoardSchema.parse(args);

        const params: Record<string, any> = { name, defaultLists };
        if (desc) params.desc = desc;
        if (idOrganization) params.idOrganization = idOrganization;
        if (prefs_permissionLevel) params['prefs_permissionLevel'] = prefs_permissionLevel;
        if (prefs_background) params['prefs_background'] = prefs_background;

        const response = await client.post('/boards/', params);
        const b = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Board created!\nID: ${b.id}\nName: ${b.name}\nURL: ${b.url}`,
            },
          ],
        };
      }

      case 'trello_update_board': {
        const { board_id, name, desc, closed, subscribed, prefs_permissionLevel, prefs_background } =
          UpdateBoardSchema.parse(args);

        const params: Record<string, any> = {};
        if (name !== undefined) params.name = name;
        if (desc !== undefined) params.desc = desc;
        if (closed !== undefined) params.closed = closed;
        if (subscribed !== undefined) params.subscribed = subscribed;
        if (prefs_permissionLevel) params['prefs/permissionLevel'] = prefs_permissionLevel;
        if (prefs_background) params['prefs/background'] = prefs_background;

        await client.put(`/boards/${board_id}`, params);

        return {
          content: [{ type: 'text', text: `Board ${board_id} updated successfully.` }],
        };
      }

      case 'trello_delete_board': {
        const { board_id } = DeleteBoardSchema.parse(args);
        await client.delete(`/boards/${board_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Board ${board_id} permanently deleted. This action cannot be undone.`,
            },
          ],
        };
      }

      case 'trello_get_board_actions': {
        const { board_id, filter, limit, since, before } = GetBoardActionsSchema.parse(args);

        const params: Record<string, any> = { limit };
        if (filter) params.filter = filter;
        if (since) params.since = since;
        if (before) params.before = before;

        const response = await client.get(`/boards/${board_id}/actions`, { params });
        const actions: any[] = response.data || [];

        if (actions.length === 0) {
          return { content: [{ type: 'text', text: 'No actions found for this board.' }] };
        }

        const list = actions
          .map((a: any) => {
            const creator = a.memberCreator
              ? `${a.memberCreator.fullName || a.memberCreator.username}`
              : 'Unknown';
            return `ID: ${a.id}\nType: ${a.type}\nDate: ${a.date}\nBy: ${creator}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${actions.length} action(s):\n\n${list}` }],
        };
      }

      case 'trello_get_board_cards': {
        const { board_id, filter } = GetBoardCardsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/cards/${filter}`);
        const cards: any[] = response.data || [];

        if (cards.length === 0) {
          return { content: [{ type: 'text', text: 'No cards found on this board.' }] };
        }

        const list = cards
          .map(
            (c: any) =>
              `ID: ${c.id}\nName: ${c.name}\nDescription: ${c.desc || 'N/A'}\nList ID: ${c.idList}\nDue: ${c.due || 'N/A'}\nURL: ${c.url}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${cards.length} card(s):\n\n${list}` }],
        };
      }

      case 'trello_get_board_checklists': {
        const { board_id } = GetBoardChecklistsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/checklists`);
        const checklists: any[] = response.data || [];

        if (checklists.length === 0) {
          return { content: [{ type: 'text', text: 'No checklists found on this board.' }] };
        }

        const list = checklists
          .map((cl: any) => {
            const items = (cl.checkItems || [])
              .map((item: any) => `  [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`)
              .join('\n');
            return `ID: ${cl.id}\nName: ${cl.name}\nCard ID: ${cl.idCard}\nItems:\n${items || '  (none)'}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${checklists.length} checklist(s):\n\n${list}` }],
        };
      }

      case 'trello_get_board_custom_fields': {
        const { board_id } = GetBoardCustomFieldsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/customFields`);
        const fields: any[] = response.data || [];

        if (fields.length === 0) {
          return { content: [{ type: 'text', text: 'No custom fields found on this board.' }] };
        }

        const list = fields
          .map(
            (f: any) =>
              `ID: ${f.id}\nName: ${f.name}\nType: ${f.type}\nPosition: ${f.pos}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${fields.length} custom field(s):\n\n${list}` }],
        };
      }

      case 'trello_get_board_labels': {
        const { board_id, limit } = GetBoardLabelsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/labels`, { params: { limit } });
        const labels: any[] = response.data || [];

        if (labels.length === 0) {
          return { content: [{ type: 'text', text: 'No labels found on this board.' }] };
        }

        const list = labels
          .map((l: any) => `ID: ${l.id}\nName: ${l.name || '(unnamed)'}\nColor: ${l.color || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${labels.length} label(s):\n\n${list}` }],
        };
      }

      case 'trello_create_board_label': {
        const { board_id, name, color } = CreateBoardLabelSchema.parse(args);
        const response = await client.post(`/boards/${board_id}/labels`, { name, color });
        const label = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Label created!\nID: ${label.id}\nName: ${label.name}\nColor: ${label.color}`,
            },
          ],
        };
      }

      case 'trello_get_board_lists': {
        const { board_id, filter } = GetBoardListsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/lists`, { params: { filter } });
        const lists: any[] = response.data || [];

        if (lists.length === 0) {
          return { content: [{ type: 'text', text: 'No lists found on this board.' }] };
        }

        const list = lists
          .map((l: any) => `ID: ${l.id}\nName: ${l.name}\nClosed: ${l.closed}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${lists.length} list(s):\n\n${list}` }],
        };
      }

      case 'trello_create_board_list': {
        const { board_id, name, pos } = CreateBoardListSchema.parse(args);

        const params: Record<string, any> = { name };
        if (pos !== undefined) params.pos = pos;

        const response = await client.post(`/boards/${board_id}/lists`, params);
        const l = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `List created!\nID: ${l.id}\nName: ${l.name}`,
            },
          ],
        };
      }

      case 'trello_get_board_members': {
        const { board_id } = GetBoardMembersSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/members`);
        const members: any[] = response.data || [];

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No members found on this board.' }] };
        }

        const list = members
          .map(
            (m: any) =>
              `ID: ${m.id}\nName: ${m.fullName || 'N/A'}\nUsername: ${m.username}\nMember Type: ${m.memberType || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${members.length} member(s):\n\n${list}` }],
        };
      }

      case 'trello_add_board_member': {
        const { board_id, member_id, type } = AddBoardMemberSchema.parse(args);
        await client.put(`/boards/${board_id}/members/${member_id}`, { type });

        return {
          content: [
            {
              type: 'text',
              text: `Member ${member_id} added to board ${board_id} with role: ${type}.`,
            },
          ],
        };
      }

      case 'trello_invite_board_member_by_email': {
        const { board_id, email, type, fullName } = InviteBoardMemberByEmailSchema.parse(args);

        const body: Record<string, any> = { email, type };
        if (fullName) body.fullName = fullName;

        await client.put(`/boards/${board_id}/members`, body);

        return {
          content: [
            {
              type: 'text',
              text: `Invitation sent to ${email} for board ${board_id} with role: ${type}.`,
            },
          ],
        };
      }

      case 'trello_remove_board_member': {
        const { board_id, member_id } = RemoveBoardMemberSchema.parse(args);
        await client.delete(`/boards/${board_id}/members/${member_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Member ${member_id} removed from board ${board_id}.`,
            },
          ],
        };
      }

      case 'trello_get_board_memberships': {
        const { board_id, filter } = GetBoardMembershipsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/memberships`, {
          params: { filter },
        });
        const memberships: any[] = response.data || [];

        if (memberships.length === 0) {
          return { content: [{ type: 'text', text: 'No memberships found for this board.' }] };
        }

        const list = memberships
          .map(
            (m: any) =>
              `ID: ${m.id}\nMember ID: ${m.idMember}\nType: ${m.memberType}\nDeactivated: ${m.deactivated}`,
          )
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${memberships.length} membership(s):\n\n${list}` },
          ],
        };
      }

      case 'trello_update_board_membership': {
        const { board_id, membership_id, type } = UpdateBoardMembershipSchema.parse(args);
        await client.put(`/boards/${board_id}/memberships/${membership_id}`, { type });

        return {
          content: [
            {
              type: 'text',
              text: `Membership ${membership_id} on board ${board_id} updated to role: ${type}.`,
            },
          ],
        };
      }

      case 'trello_mark_board_as_viewed': {
        const { board_id } = MarkBoardAsViewedSchema.parse(args);
        await client.post(`/boards/${board_id}/markedAsViewed`);

        return {
          content: [{ type: 'text', text: `Board ${board_id} marked as viewed.` }],
        };
      }

      case 'trello_generate_board_calendar_key': {
        const { board_id } = GenerateBoardCalendarKeySchema.parse(args);
        const response = await client.post(`/boards/${board_id}/calendarKey/generate`);
        const data = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Calendar key generated for board ${board_id}.\nKey: ${data._value || data.value || JSON.stringify(data)}`,
            },
          ],
        };
      }

      case 'trello_generate_board_email_key': {
        const { board_id } = GenerateBoardEmailKeySchema.parse(args);
        const response = await client.post(`/boards/${board_id}/emailKey/generate`);
        const data = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Email key generated for board ${board_id}.\nKey: ${data._value || data.value || JSON.stringify(data)}`,
            },
          ],
        };
      }

      case 'trello_get_board_plugins': {
        const { board_id } = GetBoardPluginsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/boardPlugins`);
        const plugins: any[] = response.data || [];

        if (plugins.length === 0) {
          return { content: [{ type: 'text', text: 'No power-ups enabled on this board.' }] };
        }

        const list = plugins
          .map((p: any) => `ID: ${p.id}\nPlugin ID: ${p.idPlugin}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${plugins.length} enabled power-up(s):\n\n${list}` }],
        };
      }

      case 'trello_get_available_board_plugins': {
        const { board_id } = GetAvailableBoardPluginsSchema.parse(args);
        const response = await client.get(`/boards/${board_id}/plugins`);
        const plugins: any[] = response.data || [];

        if (plugins.length === 0) {
          return { content: [{ type: 'text', text: 'No available power-ups found for this board.' }] };
        }

        const list = plugins
          .map((p: any) => `ID: ${p.id}\nName: ${p.name || 'N/A'}\nDescription: ${p.description || 'N/A'}`)
          .join('\n\n');

        return {
          content: [
            { type: 'text', text: `Found ${plugins.length} available power-up(s):\n\n${list}` },
          ],
        };
      }

      case 'trello_enable_board_plugin': {
        const { board_id, idPlugin } = EnableBoardPluginSchema.parse(args);
        const response = await client.post(`/boards/${board_id}/boardPlugins`, { idPlugin });
        const data = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Power-up ${idPlugin} enabled on board ${board_id}.\nBoardPlugin ID: ${data.id || 'N/A'}`,
            },
          ],
        };
      }

      case 'trello_disable_board_plugin': {
        const { board_id, idPlugin } = DisableBoardPluginSchema.parse(args);
        await client.delete(`/boards/${board_id}/boardPlugins/${idPlugin}`);

        return {
          content: [
            {
              type: 'text',
              text: `Power-up ${idPlugin} disabled on board ${board_id}.`,
            },
          ],
        };
      }

      default:
        return null;
    }
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}
